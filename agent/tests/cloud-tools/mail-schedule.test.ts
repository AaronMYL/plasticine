import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { CredentialFiles, MailSync } from '../../src/cloud-tools/index.ts';
import { openTestState } from '../state/helpers.ts';

test('收信扫描每十分钟一次，关闭时取消在途连接并等待落盘', async () => {
  const t = await openTestState();
  const directory = join(dirname(t.path), 'credentials');
  mkdirSync(directory);
  writeFileSync(join(directory, 'gmail'), 'placeholder');
  let at = new Date('2026-10-28T08:00:00Z');
  const sync = new MailSync({ state: t.state, credentials: new CredentialFiles(directory, false),
    now: () => at, transport: { fetch: async () => ({ uidValidity: 1, messages: [] }) } });
  try {
    assert.equal(sync.scan(), 'started');
    await sync.sync();
    at = new Date('2026-10-28T08:09:59Z');
    assert.equal(sync.scan(), 'skipped');
    at = new Date('2026-10-28T08:10:00Z');
    assert.equal(sync.scan(), 'started');
    await sync.stop();
    assert.equal(sync.scan(), 'skipped');
  } finally {
    await sync.stop();
    await t.cleanup();
  }
});
