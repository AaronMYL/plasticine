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

test('executes each action id only once and retains status only after submission', (t) => {
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

test('action interrupted mid-run reports pending verification on restart without re-running', (t) => {
  const root = tempDir(t);
  new ActionJournal(root, 'https://a.b/', 'node-1').begin('act-2', 'run_command');
  const reopened = new ActionJournal(root, 'https://a.b/', 'node-1');
  assert.deepEqual(reopened.unsent(), [{ id: 'act-2', result: INTERRUPTED }]);
  assert.match(INTERRUPTED.error ?? '', /待核实/);
  assert.throws(() => reopened.begin('../x', 'file_read'), /文件名/);
});

test('enforces strict ID character and length validation on receipt filenames', (t) => {
  const journal = new ActionJournal(tempDir(t), 'https://example.com/', 'fixture-node');
  for (const id of ['call_fixture|fc_fixture', 'x'.repeat(201), '../outside', '']) {
    assert.throws(() => journal.seen(id), /文件名/);
    assert.throws(() => journal.begin(id, 'file_read'), /文件名/);
  }
  journal.begin('a'.repeat(200), 'file_read');
  assert.equal(journal.seen('a'.repeat(200)), true);
});

test('stores credentials encrypted with 0600 mode and migrates Swift plaintext once keeping old file', (t) => {
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

test('reports keychain unavailability instead of falling back to plaintext', (t) => {
  const store = new CredentialStore(tempDir(t), null, { ...cipher, available: () => false });
  assert.throws(() => store.save('https://a.b/', 'secret'), /钥匙串/);
});
