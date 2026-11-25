import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { generateVapidKeys, loadOrCreateVapidKeys, VAPID_KEY_FILE } from '../../src/attention/index.ts';

async function withDirectory(work: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'plasticine-vapid-'));
  try {
    await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('generates 0600 VAPID keypair in state dir on first use and reloads same pair thereafter', async () => {
  await withDirectory(async (directory) => {
    const first = await loadOrCreateVapidKeys(directory);
    const second = await loadOrCreateVapidKeys(directory);
    assert.deepEqual(second, first);
    const info = await stat(join(directory, VAPID_KEY_FILE));
    const expected = process.platform === 'win32' ? info.mode & 0o777 : 0o600;
    assert.equal(info.mode & 0o777, expected);
  });
});

test('concurrent first VAPID key load generates a single shared keypair for all callers', async () => {
  await withDirectory(async (directory) => {
    const pairs = await Promise.all([1, 2, 3].map(() => loadOrCreateVapidKeys(directory)));
    assert.deepEqual(pairs[1], pairs[0]);
    assert.deepEqual(pairs[2], pairs[0]);
    const stored: unknown = JSON.parse(await readFile(join(directory, VAPID_KEY_FILE), 'utf8'));
    assert.deepEqual(stored, pairs[0]);
    assert.deepEqual(await readdir(directory), [VAPID_KEY_FILE]);
  });
});

test('corrupt VAPID key file (mismatched pair or bad JSON) refuses startup instead of regenerating', async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, VAPID_KEY_FILE);
    const mixed = { publicKey: generateVapidKeys().publicKey, privateKey: generateVapidKeys().privateKey };
    await writeFile(path, JSON.stringify(mixed));
    await assert.rejects(loadOrCreateVapidKeys(directory), /对不上/);
    await writeFile(path, '{坏了');
    await assert.rejects(loadOrCreateVapidKeys(directory), /不是合法的 JSON/);
  });
});
