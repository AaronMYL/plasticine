// 许可边界（2026-11-09 他定）：agent/protocol/ 整个目录，加上 agent/shared/ 里开头标了 Apache-2.0 的文件（线上格式和它们
// 用到的类型），按 Apache-2.0 公开；闭源的 Cyber Hunter 中继只用这些。所以它们只能互相引用、引用 node 内置和 npm 包，
// 不能引用按 AGPL 授权的其余代码。
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

test('agent/protocol/ 的文件开头都标了 Apache-2.0', () => {
  assert.deepEqual(files('agent/protocol').filter((file) => !marked(file)), []);
});

test('Apache-2.0 的文件只引用别的 Apache-2.0 文件、node 内置和 npm 包', () => {
  const crossing: string[] = [];
  for (const file of apache) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
      const target = relative(ROOT, resolve(dirname(join(ROOT, file)), match[1]!));
      if (!apache.has(target)) crossing.push(`${file} → ${target}`);
    }
  }
  assert.deepEqual(crossing, []);
});

test('线上格式在 Apache-2.0 里：中继要用的这几个入口都标了', () => {
  for (const file of ['agent/shared/net-wire.ts', 'agent/shared/tunnel-wire.ts', 'agent/shared/release-manifest.ts',
    'agent/shared/desktop-release.ts']) assert.ok(apache.has(file), file);
});
