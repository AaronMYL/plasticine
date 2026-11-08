import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import {
  checkPublicHttpsUrl,
  CloudToolError,
  CredentialFiles,
  displayUrl,
  isPrivateHost,
} from '../../src/cloud-tools/index.ts';
import { tempDirectory } from '../state/helpers.ts';

let dir: Awaited<ReturnType<typeof tempDirectory>>;

beforeEach(async () => {
  dir = await tempDirectory();
});

afterEach(async () => {
  await dir.cleanup();
});

function refused(raw: string): string {
  try {
    checkPublicHttpsUrl(raw);
  } catch (error) {
    assert.ok(error instanceof CloudToolError);
    assert.equal(error.code, 'invalid_input');
    return error.message;
  }
  return 'accepted';
}

test('网址只收 https 的公网地址：带用户名密码、http、本机、内网、链路本地、单名字的都拒', () => {
  assert.equal(checkPublicHttpsUrl('https://example.com/a?b=1').hostname, 'example.com');
  assert.match(refused('https://user:pass@example.com/'), /用户名或密码/);
  assert.match(refused('http://example.com/'), /https/);
  assert.match(refused('ftp://example.com/'), /https/);
  for (const raw of [
    'https://localhost/',
    'https://127.0.0.1/',
    'https://10.1.2.3/',
    'https://192.168.1.1/',
    'https://172.20.0.1/',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/',
    'https://[fd00::1]/',
    'https://printer.local/',
    'https://intranet/',
  ]) {
    assert.match(refused(raw), /本机或内网/, raw);
  }
  assert.match(refused('不是网址'), /完整的网址/);
  assert.equal(isPrivateHost('8.8.8.8'), false);
  assert.equal(isPrivateHost('::ffff:7f00:1'), true);
  assert.equal(isPrivateHost('0:0:0:0:0:ffff:0a00:0001'), true);
  assert.equal(isPrivateHost('0:0:0:0:0:0:0:1'), true);
  assert.equal(isPrivateHost('::ffff:808:808'), false);
});

test('写进记录的网址去掉查询串和片段（可能带令牌）', () => {
  assert.equal(displayUrl(new URL('https://example.com/p/q?token=abc#x')), 'https://example.com/p/q');
});

test('凭据只看文件在不在、权限对不对；名字不合格式就拒；缺了说还没放', () => {
  const directory = join(dir.directory, 'credentials');
  mkdirSync(directory);
  writeFileSync(join(directory, 'imap'), 'not-a-real-secret', { mode: 0o644 });
  const relaxed = new CredentialFiles(directory, false);
  assert.equal(relaxed.status('imap'), 'ready');
  assert.equal(relaxed.status('smtp'), 'missing');
  assert.throws(() => relaxed.status('../plasticine.sqlite'), CloudToolError);
  assert.throws(() => relaxed.read('smtp'), (error: unknown) => {
    return error instanceof CloudToolError && error.code === 'not_configured' && !error.message.includes(directory);
  });
  const strict = new CredentialFiles(directory, true);
  chmodSync(join(directory, 'imap'), 0o644);
  assert.equal(strict.status('imap'), 'unsafe');
  assert.throws(() => strict.read('imap'), (error: unknown) => {
    const unsafe = error instanceof CloudToolError && error.code === 'credential_unsafe';
    return unsafe && !error.message.includes('not-a-real');
  });
});
