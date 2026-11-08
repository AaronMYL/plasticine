import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { adoptLocalSigning, type AdoptDeps } from '../src/updates/adopt-signing.ts';
import { tempDir } from './helpers.ts';

function deps(dir: string, change: Partial<AdoptDeps> = {}): AdoptDeps & { launched: string[] } {
  const launched: string[] = [];
  return { app: '/Applications/Plasticine.app', version: '2026.1108.000100', directory: dir, pid: 1,
    signedLocally: async () => false,
    copy: async (_from, to) => { mkdirSync(join(to, 'Contents'), { recursive: true }); },
    resign: async () => undefined,
    launchDetached: (_file, args) => launched.push(String(args[0])), log: () => undefined, launched, ...change };
}

test('还是临时签名：复制、重签、交给换版本的脚本，等新的一份起来写记号', async (t) => {
  const dir = tempDir(t);
  const input = deps(dir);
  assert.equal(await adoptLocalSigning(input), true);
  const script = readFileSync(input.launched[0] ?? '', 'utf8');
  assert.match(script, /started-2026\.1108\.100/);
  assert.match(script, /mv "\$APP\/Contents"/);
});

test('已经是本机证书签的、这一版试过了、从隔离位置打开的都不换', async (t) => {
  assert.equal(await adoptLocalSigning(deps(tempDir(t), { signedLocally: async () => true })), false);
  const dir = tempDir(t);
  await adoptLocalSigning(deps(dir));
  assert.equal(await adoptLocalSigning(deps(dir)), false);
  assert.equal(await adoptLocalSigning(deps(tempDir(t), { app: '/private/var/folders/x/AppTranslocation/y/P.app' })),
    false);
});

test('重签失败照常打开，不中断', async (t) => {
  const input = deps(tempDir(t), { resign: async () => { throw new Error('他没允许用私钥'); } });
  assert.equal(await adoptLocalSigning(input), false);
  assert.deepEqual(input.launched, []);
});
