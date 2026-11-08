import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ActionJournal, INTERRUPTED } from '../src/node/action-journal.ts';
import { CredentialStore, serverKey, type SecretCipher } from '../src/node/credential-store.ts';
import { tempDir } from './helpers.ts';

const cipher: SecretCipher = {
  available: () => true,
  encrypt: (text) => Buffer.from(text, 'utf8').reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString('utf8'),
};

test('同一个动作 id 只执行一次；交上去以后只留状态', (t) => {
  const journal = new ActionJournal(tempDir(t), 'https://a.b/', 'node-1');
  assert.equal(journal.seen('act-1'), false);
  journal.begin('act-1', 'file_read');
  assert.equal(journal.seen('act-1'), true);
  journal.finish('act-1', { status: 'executed', result: { content: 'x' } });
  assert.deepEqual(journal.unsent(), [{ id: 'act-1', result: { status: 'executed', result: { content: 'x' } } }]);
  journal.uploaded('act-1');
  assert.deepEqual(journal.unsent(), []);
  assert.equal(journal.seen('act-1'), true);
});

test('做到一半被关掉的动作：下次报结果待核实，不再做一遍', (t) => {
  const root = tempDir(t);
  new ActionJournal(root, 'https://a.b/', 'node-1').begin('act-2', 'run_command');
  const reopened = new ActionJournal(root, 'https://a.b/', 'node-1');
  assert.deepEqual(reopened.unsent(), [{ id: 'act-2', result: INTERRUPTED }]);
  assert.match(INTERRUPTED.error ?? '', /待核实/);
  assert.throws(() => reopened.begin('../x', 'file_read'), /文件名/);
});

test('凭证加密存，文件 0600；Swift 版的明文凭证搬一次，旧文件不删', (t) => {
  const dir = tempDir(t);
  const legacy = join(dir, 'legacy');
  mkdirSync(legacy);
  writeFileSync(join(legacy, serverKey('https://203.0.113.10')), 'old-secret');
  const store = new CredentialStore(join(dir, 'new'), legacy, cipher);
  assert.equal(store.read('https://203.0.113.10/'), 'old-secret');
  const sealed = join(dir, 'new', `${serverKey('https://203.0.113.10/')}.bin`);
  assert.notEqual(readFileSync(sealed, 'utf8'), 'old-secret');
  assert.equal(statSync(sealed).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(legacy, serverKey('https://203.0.113.10/')), 'utf8'), 'old-secret');
  store.forget('https://203.0.113.10/');
  assert.equal(store.read('https://203.0.113.10/'), 'old-secret');
  assert.equal(store.read('https://other.example/'), null);
});

test('钥匙串用不了就报出来，不退回明文', (t) => {
  const store = new CredentialStore(tempDir(t), null, { ...cipher, available: () => false });
  assert.throws(() => store.save('https://a.b/', 'secret'), /钥匙串/);
});
