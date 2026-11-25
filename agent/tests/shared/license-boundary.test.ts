import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const MARK = '// SPDX-License-Identifier: Apache-2.0\n';

function files(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)));
}

const marked = (file: string) => readFileSync(join(ROOT, file), 'utf8').startsWith(MARK);
const apache = new Set([...files('agent/protocol'), ...files('agent/shared').filter(marked)]);

test('requires SPDX Apache-2.0 header on every file under agent/protocol/', () => {
  assert.deepEqual(files('agent/protocol').filter((file) => !marked(file)), []);
});

test('restricts Apache-2.0 files to importing only other Apache-2.0 files, Node built-ins, and npm packages', () => {
  const crossing: string[] = [];
  for (const file of apache) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
      const target = relative(ROOT, resolve(dirname(join(ROOT, file)), match[1]!));
      if (!apache.has(target)) crossing.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(crossing, []);
});

test('keeps relay wire-format entrypoints under Apache-2.0 licensing', () => {
  for (const file of ['agent/shared/net-wire.ts', 'agent/shared/tunnel-wire.ts', 'agent/shared/release-manifest.ts',
    'agent/shared/desktop-release.ts']) assert.ok(apache.has(file), file);
});
