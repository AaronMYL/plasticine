// 拿真的服务包从头到尾试装一遍（docs/install-packages.md「怎么验证」；CI 的 Linux 任务也跑这个）：
//   node scripts/packages/linux-e2e.ts dist/packages/plasticine-server-<版本>.tar.gz
// 没有 docker / systemd 的机器上用临时前缀 + 假 systemctl（testing/linux-harness.ts）：install.sh 装 → 空状态目录
// 起服务、答健康检查、发客户端 → 自更新到下一版 → 坏版本自动退回 → 手动回退 → 卸载留数据 → --purge 全删。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createSandbox, destroy, health, publish, run, type Sandbox } from './testing/linux-harness.ts';
import { parseServerManifest } from './release-manifest.ts';

function unpack(sandbox: Sandbox, tarball: string, name: string): string {
  const directory = join(sandbox.root, name);
  mkdirSync(directory, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', directory, '--strip-components=1']);
  return directory;
}

/** 同一份包换个版本号；broken 时让 main.ts 一启动就退出。 */
function variant(directory: string, version: string, broken = false): void {
  const file = join(directory, 'manifest.json');
  const manifest = parseServerManifest(readFileSync(file, 'utf8'));
  writeFileSync(file, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  if (broken) {
    writeFileSync(join(directory, 'agent/src/app/main.ts'), 'process.exit(1);\n');
  }
}

async function step(name: string, work: () => Promise<void> | void): Promise<void> {
  process.stderr.write(`· ${name}\n`);
  await work();
}

async function main(tarball: string): Promise<void> {
  const sandbox = await createSandbox();
  const app = join(sandbox.prefix, 'opt/plasticine');
  const state = join(sandbox.prefix, 'var/lib/plasticine/state');
  const ctl = join(sandbox.prefix, 'usr/local/bin/plasticine');
  try {
    const first = unpack(sandbox, tarball, 'v1');
    const v1 = parseServerManifest(readFileSync(join(first, 'manifest.json'), 'utf8')).version;
    const [year, day, time] = v1.split('.').map(Number);
    const v2 = `${year}.${String(day).padStart(4, '0')}.${String((time ?? 0) + 1).padStart(6, '0')}`;
    const v3 = `${year}.${String(day).padStart(4, '0')}.${String((time ?? 0) + 2).padStart(6, '0')}`;

    await step(`install.sh 装 ${v1}，空状态目录起服务`, async () => {
      publish(sandbox, first, v1);
      const installed = run(sandbox, 'sh', [join(sandbox.release, 'install.sh')]);
      assert.equal(installed.code, 0, installed.output);
      assert.deepEqual(await health(sandbox), { ok: true, accepting: true, dryRun: false });
      assert.ok(existsSync(join(state, 'plasticine.sqlite')));
      const page = await fetch(`http://127.0.0.1:${sandbox.port}/`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /<html/);
    });

    await step(`plasticine update → ${v2}`, async () => {
      const second = unpack(sandbox, tarball, 'v2');
      variant(second, v2);
      publish(sandbox, second, v2);
      const updated = run(sandbox, ctl, ['update']);
      assert.equal(updated.code, 0, updated.output);
      assert.equal(readlinkSync(join(app, 'current')), `versions/${v2}`);
      assert.equal((await health(sandbox))?.['ok'], true);
    });

    await step(`坏版本 ${v3} 自动退回 ${v2}`, async () => {
      const third = unpack(sandbox, tarball, 'v3');
      variant(third, v3, true);
      publish(sandbox, third, v3);
      const updated = run(sandbox, ctl, ['update']);
      assert.notEqual(updated.code, 0);
      assert.equal(readlinkSync(join(app, 'current')), `versions/${v2}`);
      assert.equal((await health(sandbox))?.['ok'], true);
    });

    await step(`plasticine rollback → ${v1}`, async () => {
      const rolled = run(sandbox, ctl, ['rollback']);
      assert.equal(rolled.code, 0, rolled.output);
      assert.equal(readlinkSync(join(app, 'current')), `versions/${v1}`);
      assert.equal((await health(sandbox))?.['ok'], true);
    });

    await step('卸载留数据，--purge 全删', async () => {
      const removed = run(sandbox, 'sh', [join(sandbox.release, 'install.sh'), '--uninstall']);
      assert.equal(removed.code, 0, removed.output);
      assert.equal(existsSync(app), false);
      assert.equal(await health(sandbox, 0), null);
      assert.ok(existsSync(join(state, 'plasticine.sqlite')));
      const purged = run(sandbox, 'sh', [join(sandbox.release, 'install.sh'), '--uninstall', '--purge']);
      assert.equal(purged.code, 0, purged.output);
      assert.equal(existsSync(state), false);
    });
    process.stderr.write('Linux 安装包端到端：通过\n');
  } finally {
    if (process.env['PLASTICINE_E2E_KEEP'] === '1') {
      process.stderr.write(`场地留着：${sandbox.root}\n`);
    } else {
      destroy(sandbox);
    }
  }
}

const tarball = process.argv[2];
if (tarball === undefined) {
  console.error('用法：node scripts/packages/linux-e2e.ts <plasticine-server-版本.tar.gz>');
  process.exitCode = 2;
} else {
  await main(resolve(tarball));
}
