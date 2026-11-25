import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { precompressDirectory } from '../client/build-compress.ts';

test('pre-compresses text UI assets into .br and .gz files that decompress identically', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-compress-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'assets'));
  const script = 'export const note = "搬家前要想清楚的事";\n'.repeat(400);
  writeFileSync(join(directory, 'assets', 'main-1a2b.js'), script);
  writeFileSync(join(directory, 'index.html'), `<!doctype html>${'<p>Plasticine</p>'.repeat(200)}`);
  writeFileSync(join(directory, 'assets', 'tiny.css'), 'a{}');
  writeFileSync(join(directory, 'assets', 'font.woff2'), Buffer.alloc(4096, 7));
  const written = precompressDirectory(directory);
  assert.deepEqual(written, ['assets/main-1a2b.js.br', 'assets/main-1a2b.js.gz', 'index.html.br', 'index.html.gz']);
  assert.equal(brotliDecompressSync(readFileSync(join(directory, 'assets', 'main-1a2b.js.br'))).toString(), script);
  assert.equal(gunzipSync(readFileSync(join(directory, 'assets', 'main-1a2b.js.gz'))).toString(), script);
  assert.equal(existsSync(join(directory, 'assets', 'tiny.css.br')), false);
  assert.equal(existsSync(join(directory, 'assets', 'font.woff2.br')), false);
});

test('discards compressed files that save less than 10 percent', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-compress-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const random = randomBytes(8192);
  writeFileSync(join(directory, 'noise.wasm'), random);
  assert.deepEqual(precompressDirectory(directory), []);
});
