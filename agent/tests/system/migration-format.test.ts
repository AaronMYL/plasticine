import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrationFileError, MigrationWriter, readArchive, readHeader } from '../../src/system/migration/index.ts';
import { deriveKey, FRAME_BYTES, type EntrySink } from '../../src/system/migration/format.ts';

async function collectAll(path: string, key: Buffer | null): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  await readArchive(path, key, {
    begin: async (name): Promise<EntrySink> => {
      const parts: Buffer[] = [];
      return {
        write: async (chunk) => {
          parts.push(Buffer.from(chunk));
        },
        close: async () => {
          out.set(name, Buffer.concat(parts));
        },
      };
    },
  });
  return out;
}

async function sample(directory: string, passphrase: string | null): Promise<{ path: string; big: Buffer }> {
  const big = Buffer.alloc(FRAME_BYTES * 2 + 12345);
  for (let index = 0; index < big.length; index += 1) {
    big[index] = (index * 31) % 251;
  }
  const source = join(directory, 'big.bin');
  writeFileSync(source, big);
  const path = join(directory, passphrase === null ? 'plain.plasticine' : 'locked.plasticine');
  const writer = await MigrationWriter.create(path, passphrase === null ? 'data' : 'full', passphrase);
  await writer.add('summary.json', Buffer.from('{"hello":"你好"}'));
  await writer.add('files/big.bin', source);
  await writer.add('files/empty.txt', Buffer.alloc(0));
  await writer.finish();
  return { path, big };
}

test('Unencrypted archive marks data-only in header and verifies every record in order', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'migration-format-'));
  try {
    const { path, big } = await sample(directory, null);
    const { header } = await readHeader(path);
    assert.deepEqual(header, { format: 'plasticine-migration-v1', mode: 'data', encrypted: false });
    const entries = await collectAll(path, null);
    assert.deepEqual([...entries.keys()], ['summary.json', 'files/big.bin', 'files/empty.txt']);
    assert.equal(entries.get('summary.json')?.toString(), '{"hello":"你好"}');
    assert.ok(entries.get('files/big.bin')?.equals(big));
    assert.equal(entries.get('files/empty.txt')?.length, 0);
    assert.equal(readFileSync(path).includes(Buffer.from('你好')), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Encrypted archive hides content, rejects wrong passphrase on frame 1 or tamper', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'migration-format-'));
  try {
    const { path, big } = await sample(directory, 'correct horse battery');
    const { header } = await readHeader(path);
    assert.equal(header.encrypted, true);
    assert.equal(header.mode, 'full');
    assert.equal(readFileSync(path).includes(Buffer.from('你好')), false);
    const key = await deriveKey('correct horse battery', header.kdf!);
    const entries = await collectAll(path, key);
    assert.ok(entries.get('files/big.bin')?.equals(big));
    const wrong = await deriveKey('wrong horse battery', header.kdf!);
    await assert.rejects(collectAll(path, wrong), (error: unknown) =>
      error instanceof MigrationFileError && error.code === 'wrong_passphrase');
    await assert.rejects(collectAll(path, null), (error: unknown) =>
      error instanceof MigrationFileError && error.code === 'wrong_passphrase');
    const bytes = readFileSync(path);
    const tampered = join(directory, 'tampered.plasticine');
    const copy = Buffer.from(bytes);
    copy[copy.length - 100] = (copy[copy.length - 100] ?? 0) ^ 1;
    writeFileSync(tampered, copy);
    await assert.rejects(collectAll(tampered, key), (error: unknown) =>
      error instanceof MigrationFileError && error.code === 'bad_file');
    const cut = join(directory, 'cut.plasticine');
    writeFileSync(cut, bytes);
    truncateSync(cut, bytes.length - FRAME_BYTES / 2);
    await assert.rejects(collectAll(cut, key), (error: unknown) =>
      error instanceof MigrationFileError && error.code === 'bad_file');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Non-migration file is immediately rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'migration-format-'));
  try {
    const path = join(directory, 'notes.txt');
    writeFileSync(path, '只是一段文字，不是 Plasticine 的迁移文件');
    await assert.rejects(readHeader(path), /不是 Plasticine 导出的迁移文件/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
