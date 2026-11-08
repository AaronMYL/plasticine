import assert from 'node:assert/strict';
import { existsSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_RELEASE_URL, PACKAGE_NODE_VERSION } from './release-manifest.ts';
import { createSandbox, destroy, fakeServerPackage, health, publish, run } from './testing/linux-harness.ts';

const INSTALLER = 'scripts/packages/linux/install.sh';
const V1 = '2026.1101.000000';
const V2 = '2026.1105.120000';
const V3 = '2026.1106.120000';

test('install.sh 里的默认发布点和 Node 版本与 release-manifest.ts 一致', () => {
  const source = readFileSync(INSTALLER, 'utf8');
  assert.match(source, new RegExp(`^DEFAULT_RELEASE_URL="${DEFAULT_RELEASE_URL}"$`, 'm'));
  assert.match(source, new RegExp(`^DEFAULT_NODE_VERSION="${PACKAGE_NODE_VERSION.replaceAll('.', '\\.')}"$`, 'm'));
});

test('单元文件：以 plasticine 用户跑 current 里的服务，自己发客户端，自更新每天一次', () => {
  const service = readFileSync('scripts/packages/linux/plasticine.service', 'utf8');
  for (const line of ['User=plasticine', 'WorkingDirectory=/opt/plasticine/current',
    'Environment=PLASTICINE_STATE=/var/lib/plasticine/state', 'Environment=PLASTICINE_CLIENT_DIR=client/dist',
    'Environment=PLASTICINE_PLAIN_HTTP=1', 'Environment=PLASTICINE_DRY_RUN=0',
    'EnvironmentFile=-/etc/plasticine/plasticine.env',
    'ExecStart=/opt/plasticine/node/bin/node agent/src/app/main.ts', 'Restart=on-failure']) {
    assert.ok(service.split('\n').includes(line), line);
  }
  // 2026-11-05 他定：朋友的实例真跑（外部动作照做，硬线审批照样拦）；自迭代已经删了，不再有它的开关。
  assert.doesNotMatch(service, /PLASTICINE_SELF_CODE/);
  const timer = readFileSync('scripts/packages/linux/plasticine-update.timer', 'utf8');
  assert.match(timer, /^OnBootSec=/m);
  assert.match(timer, /^OnUnitActiveSec=1d$/m);
});

test('不是 root、也没给测试前缀时拒绝安装', () => {
  if (process.getuid?.() === 0) {
    return;
  }
  const result = run({ env: { ...process.env, PLASTICINE_PREFIX: '' } }, 'sh', [INSTALLER]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /要用 root 运行/);
});

test('在临时前缀里装、自更新、坏版本自动退回、手动回退、卸载留数据、--purge 全删', async (t) => {
  const sandbox = await createSandbox();
  t.after(() => destroy(sandbox));
  const prefix = sandbox.prefix;
  const app = join(prefix, 'opt/plasticine');
  const data = join(prefix, 'var/lib/plasticine');
  const ctl = join(prefix, 'usr/local/bin/plasticine');

  await t.test('第一次安装：Node、服务包、用户、数据目录、设置、单元、命令都到位，服务答上健康检查', async () => {
    fakeServerPackage(join(sandbox.root, 'pkg-v1'), V1);
    publish(sandbox, join(sandbox.root, 'pkg-v1'), V1);
    const installed = run(sandbox, 'sh', [join(sandbox.release, 'install.sh')]);
    assert.equal(installed.code, 0, installed.output);
    assert.match(installed.output, /ssh -N -L/);
    assert.equal(readlinkSync(join(app, 'current')), `versions/${V1}`);
    assert.equal(existsSync(join(app, 'previous')), false);
    assert.equal((await health(sandbox))?.['version'], V1);
    assert.equal(statSync(join(data, 'state')).mode & 0o777, 0o700);
    assert.ok(existsSync(join(data, 'state', `started-${V1}`)));
    const unit = readFileSync(join(prefix, 'etc/systemd/system/plasticine.service'), 'utf8');
    assert.match(unit, new RegExp(`^WorkingDirectory=${app}/current$`, 'm'));
    assert.match(readFileSync(join(prefix, 'etc/plasticine/plasticine.env'), 'utf8'),
      new RegExp(`^PLASTICINE_PORT=${sandbox.port}$`, 'm'));
    assert.ok(existsSync(join(sandbox.root, 'user-plasticine')));
    const calls = readFileSync(join(sandbox.systemdState, 'calls.log'), 'utf8');
    assert.match(calls, /^enable plasticine\.service plasticine-update\.timer$/m);
  });

  await t.test('再跑一次安装命令：同一版不重下，服务照常', async () => {
    const again = run(sandbox, 'sh', [join(sandbox.release, 'install.sh')]);
    assert.equal(again.code, 0, again.output);
    assert.match(again.output, new RegExp(`服务已是 ${V1}`));
    assert.equal((await health(sandbox))?.['version'], V1);
  });

  await t.test('plasticine update：换到新版并重启，旧版留作 previous', async () => {
    fakeServerPackage(join(sandbox.root, 'pkg-v2'), V2);
    publish(sandbox, join(sandbox.root, 'pkg-v2'), V2);
    const updated = run(sandbox, ctl, ['update']);
    assert.equal(updated.code, 0, updated.output);
    assert.equal(readlinkSync(join(app, 'current')), `versions/${V2}`);
    assert.equal(readlinkSync(join(app, 'previous')), `versions/${V1}`);
    assert.equal((await health(sandbox))?.['version'], V2);
  });

  await t.test('新版一启动就退出：健康检查不过，自动退回，服务仍是上一版', async () => {
    fakeServerPackage(join(sandbox.root, 'pkg-v3'), V3, { broken: true });
    publish(sandbox, join(sandbox.root, 'pkg-v3'), V3);
    const updated = run(sandbox, ctl, ['update']);
    assert.notEqual(updated.code, 0);
    assert.match(updated.output, /"kind":"rolled_back"/);
    assert.equal(readlinkSync(join(app, 'current')), `versions/${V2}`);
    assert.equal(readlinkSync(join(app, 'previous')), `versions/${V1}`);
    assert.equal(existsSync(join(app, 'versions', V3)), false);
    assert.equal((await health(sandbox))?.['version'], V2);
    assert.match(run(sandbox, ctl, ['status']).output, new RegExp(`"skipped": \\[\\s*"${V3}"`));
  });

  await t.test('plasticine rollback：回到上一版', async () => {
    const rolled = run(sandbox, ctl, ['rollback']);
    assert.equal(rolled.code, 0, rolled.output);
    assert.equal(readlinkSync(join(app, 'current')), `versions/${V1}`);
    assert.equal(readlinkSync(join(app, 'previous')), `versions/${V2}`);
    assert.equal((await health(sandbox))?.['version'], V1);
  });

  await t.test('卸载：程序和单元删掉、服务停了，数据和设置留着', async () => {
    const removed = run(sandbox, 'sh', [join(sandbox.release, 'install.sh'), '--uninstall']);
    assert.equal(removed.code, 0, removed.output);
    assert.equal(existsSync(app), false);
    assert.equal(existsSync(ctl), false);
    assert.equal(existsSync(join(prefix, 'etc/systemd/system/plasticine.service')), false);
    assert.equal(await health(sandbox, 0), null);
    assert.ok(existsSync(join(data, 'state', `started-${V1}`)));
    assert.ok(existsSync(join(prefix, 'etc/plasticine/plasticine.env')));
  });

  await t.test('--uninstall --purge：数据、设置和用户都删掉', () => {
    const purged = run(sandbox, 'sh', [join(sandbox.release, 'install.sh'), '--uninstall', '--purge']);
    assert.equal(purged.code, 0, purged.output);
    assert.equal(existsSync(data), false);
    assert.equal(existsSync(join(prefix, 'etc/plasticine')), false);
    assert.equal(existsSync(join(sandbox.root, 'user-plasticine')), false);
  });
});

test('发布清单里的服务包被换过（SHA-256 对不上）就不装', async (t) => {
  const sandbox = await createSandbox();
  t.after(() => destroy(sandbox));
  fakeServerPackage(join(sandbox.root, 'pkg'), V1);
  publish(sandbox, join(sandbox.root, 'pkg'), V1);
  fakeServerPackage(join(sandbox.root, 'other'), V2);
  publish(sandbox, join(sandbox.root, 'other'), V2);
  const manifest = JSON.parse(readFileSync(join(sandbox.release, 'manifest.json'), 'utf8')) as {
    assets: { server: { sha256: string } } };
  manifest.assets.server.sha256 = 'f'.repeat(64);
  writeFileSync(join(sandbox.release, 'manifest.json'), JSON.stringify(manifest));
  const result = run(sandbox, 'sh', [join(sandbox.release, 'install.sh')]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /SHA-256 和发布清单对不上/);
  assert.equal(existsSync(join(sandbox.prefix, 'opt/plasticine/current')), false);
});
