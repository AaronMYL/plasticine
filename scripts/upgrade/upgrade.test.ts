// 依赖自动升级（11-18）：公开 Issue 的正文不可信——名单外的包、不是 x.y.z、降级、原来没锁死的一律拒绝；electron 连
// allowScripts 里的「包@旧版本」一起换；「合并 <SHA>」只认 40 位提交号。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyUpgrade, branchName, commitMessage, mergeTarget, newer, parseRequest, UpgradeError } from './upgrade.ts';

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'upgrade-'));
  mkdirSync(join(root, 'agent'));
  mkdirSync(join(root, 'desktop'));
  writeFileSync(join(root, 'agent', 'package.json'), `${JSON.stringify({ name: 'agent', dependencies: {
    '@earendil-works/pi-agent-core': '1.5.0', '@earendil-works/pi-ai': '1.5.0', 'acme-client': '^5.4.0' } },
  null, 2)}\n`);
  writeFileSync(join(root, 'desktop', 'package.json'), `${JSON.stringify({ name: 'desktop',
    devDependencies: { electron: '45.2.3' }, allowScripts: { 'electron@45.2.3': true, 'esbuild@0.28.2': true } },
  null, 2)}\n`);
  return root;
}

const body = (packages: unknown): string => `pi-ai 有新版\n\n<!-- upgrade-request ${JSON.stringify({ packages })} -->\n`;

test('正文里的请求：名单里的包、x.y.z 才收', () => {
  assert.deepEqual(parseRequest(body({ '@earendil-works/pi-ai': '1.5.2' })), { '@earendil-works/pi-ai': '1.5.2' });
  assert.throws(() => parseRequest('没有请求'), UpgradeError);
  assert.throws(() => parseRequest(body({ 'left-pad': '1.0.0' })), /名单/);
  assert.throws(() => parseRequest(body({ electron: '46.0.0-beta.1' })), /x\.y\.z/);
  assert.throws(() => parseRequest(body({ electron: '1.0.0; rm -rf /' })), /x\.y\.z/);
  assert.throws(() => parseRequest(body({})), /一到四/);
  assert.equal(newer('1.5.10', '1.5.9'), true);
  assert.equal(newer('1.5.0', '1.5.0'), false);
});

test('pi-ai、pi-agent-core 一起升：只改版本号，分支名和提交说明写清楚从几到几', () => {
  const root = repo();
  try {
    const changes = applyUpgrade(root, { '@earendil-works/pi-ai': '1.5.2', '@earendil-works/pi-agent-core': '1.5.2' });
    const manifest = JSON.parse(readFileSync(join(root, 'agent', 'package.json'), 'utf8')) as
      { dependencies: Record<string, string> };
    assert.equal(manifest.dependencies['@earendil-works/pi-ai'], '1.5.2');
    assert.equal(manifest.dependencies['@earendil-works/pi-agent-core'], '1.5.2');
    assert.equal(manifest.dependencies['acme-client'], '^5.4.0');
    assert.equal(branchName(changes), 'upgrade/pi-ai-1.5.2');
    assert.match(commitMessage(changes), /pi-ai：1\.5\.0 → 1\.5\.2/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('electron 升级连 allowScripts 里的旧版本一起换；降级、原来没锁死的不改', () => {
  const root = repo();
  try {
    applyUpgrade(root, { electron: '45.3.4' });
    const manifest = JSON.parse(readFileSync(join(root, 'desktop', 'package.json'), 'utf8')) as
      { devDependencies: Record<string, string>; allowScripts: Record<string, boolean> };
    assert.equal(manifest.devDependencies['electron'], '45.3.4');
    assert.deepEqual(manifest.allowScripts, { 'electron@45.3.4': true, 'esbuild@0.28.2': true });
    assert.throws(() => applyUpgrade(root, { electron: '45.3.4' }), /不比/);
    assert.throws(() => applyUpgrade(root, { 'acme-client': '5.5.0' }), /锁死/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('合并评论只认「合并 」加 40 位提交号', () => {
  const sha = 'a'.repeat(40);
  assert.equal(mergeTarget(`合并 ${sha}`), sha);
  assert.equal(mergeTarget(`合并 ${sha}\n`), sha);
  assert.equal(mergeTarget('合并 abc'), null);
  assert.equal(mergeTarget(`请合并 ${sha}`), null);
});
