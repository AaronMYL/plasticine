import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { cbcKey, ChromeImportProblem, cookieHosts, decryptValue, readCookies, siteOf,
  windowsEncryptedKey } from '../src/logins/chrome-cookies.ts';
import { tempDir } from './helpers.ts';

const EPOCH = 11_644_473_600_000_000n;

function cbc(key: Buffer, host: string, value: string): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  const plain = Buffer.concat([createHash('sha256').update(host).digest(), Buffer.from(value)]);
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain), cipher.final()]);
}

function gcm(key: Buffer, host: string, value: string, prefix = 'v10'): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const plain = Buffer.concat([createHash('sha256').update(host).digest(), Buffer.from(value)]);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from(prefix), nonce, body, cipher.getAuthTag()]);
}

function database(dir: string, rows: { host: string; name: string; encrypted: Buffer; expires: bigint }[]): string {
  const file = join(dir, 'Cookies');
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version', '24');");
  db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, '
    + 'expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)');
  const insert = db.prepare('INSERT INTO cookies VALUES (?, ?, \'\', ?, \'/\', ?, 1, 1, 1)');
  for (const row of rows) {
    insert.run(row.host, row.name, row.encrypted, row.expires);
  }
  db.close();
  return file;
}

test('Mac 的 v10：口令派生钥匙解开，去掉库版本 24 的域名摘要；过期的跳过', (t) => {
  const key = cbcKey('chrome-safe-storage-secret', 1003);
  const future = BigInt(Date.parse('2030-01-01T00:00:00Z')) * 1000n + EPOCH;
  const past = BigInt(Date.parse('2020-01-01T00:00:00Z')) * 1000n + EPOCH;
  const file = database(tempDir(t), [
    { host: '.github.com', name: 'user_session', encrypted: cbc(key.key, '.github.com', '会话值'), expires: future },
    { host: 'www.douyin.com', name: 'old', encrypted: cbc(key.key, 'www.douyin.com', 'x'), expires: past },
    { host: 'x.com', name: 'session', encrypted: cbc(key.key, 'x.com', 'y'), expires: 0n },
  ]);
  const { cookies, skipped } = readCookies(file, key, new Date('2026-11-08T00:00:00Z'));
  assert.equal(skipped, 1);
  assert.equal(cookies[0]?.value, '会话值');
  assert.equal(cookies[0]?.expires, Date.parse('2030-01-01T00:00:00Z') / 1000);
  assert.equal(cookies[1]?.expires, null);
  assert.deepEqual(cookieHosts(file).sort(), ['.github.com', 'www.douyin.com', 'x.com']);
});

test('Windows 的 v10 / v11 用 AES-GCM 解开；v20（App-Bound）解不开就跳过计数', (t) => {
  const raw = randomBytes(32);
  const key = { scheme: 'gcm' as const, key: raw };
  const future = BigInt(Date.parse('2030-01-01T00:00:00Z')) * 1000n + EPOCH;
  const file = database(tempDir(t), [
    { host: '.zhihu.com', name: 'z_c0', encrypted: gcm(raw, '.zhihu.com', 'token'), expires: future },
    { host: '.bilibili.com', name: 'SESSDATA', encrypted: gcm(raw, '.bilibili.com', 's', 'v20'), expires: future },
  ]);
  const { cookies, skipped } = readCookies(file, key, new Date('2026-11-08T00:00:00Z'));
  assert.deepEqual(cookies.map((cookie) => cookie.value), ['token']);
  assert.equal(skipped, 1);
});

test('钥匙不对解不开就是 null，不猜', () => {
  const right = cbcKey('a', 1003);
  const wrong = cbcKey('b', 1003);
  assert.equal(decryptValue(cbc(right.key, 'h', 'v'), wrong, true), null);
  assert.equal(decryptValue(Buffer.from('plain'), right, false), null);
});

test('Local State 的钥匙去掉 DPAPI 前缀；格式不对说清楚', () => {
  const encoded = Buffer.concat([Buffer.from('DPAPI'), Buffer.from([1, 2, 3])]).toString('base64');
  assert.deepEqual([...windowsEncryptedKey(JSON.stringify({ os_crypt: { encrypted_key: encoded } }))], [1, 2, 3]);
  assert.throws(() => windowsEncryptedKey('{}'), ChromeImportProblem);
  assert.throws(() => windowsEncryptedKey('坏'), ChromeImportProblem);
});

test('没有库时说清楚；按可注册域名归在一起', (t) => {
  assert.throws(() => readCookies(join(tempDir(t), 'none'), cbcKey('a', 1), new Date()), /没找到 Chrome/);
  assert.equal(siteOf('.www.github.com'), 'github.com');
  assert.equal(siteOf('a.b.example.com.cn'), 'example.com.cn');
  assert.equal(siteOf('127.0.0.1'), '127.0.0.1');
});
