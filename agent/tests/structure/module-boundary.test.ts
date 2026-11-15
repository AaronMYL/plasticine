// 目录就是模块（plasticine-code / references/structure.md）：agent/src/<模块>/ 之间只经对方的 index.ts 往来，
// 不引别的模块的内部文件；模块里的文件不引自己的 index.ts；agent/src 根上不放散文件；每个模块都有 index.ts，
// 并且单独拿出来第一个 import 也不出错（模块之间互相引用时，谁先加载都得行）。违反了 npm run check 不过。

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

const rel = (path: string): string => relative(SRC, path).replaceAll('\\', '/');
const moduleOf = (path: string): string => path.split('/')[0] ?? '';
/** 静态导入、export … from、动态 import() 里的相对路径。 */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;

test('agent/src 根上不放散文件，每个模块都有 index.ts', () => {
  const entries = readdirSync(SRC);
  const loose = entries.filter((name) => statSync(join(SRC, name)).isFile());
  assert.deepEqual(loose, [], '新文件放进某个业务包或 util/');
  const missing = entries.filter((name) => statSync(join(SRC, name)).isDirectory()
    && !existsSync(join(SRC, name, 'index.ts')));
  assert.deepEqual(missing, []);
});

test('模块之间只经 index.ts 往来：不跨模块引内部文件', () => {
  const found: string[] = [];
  for (const path of sourceFiles(SRC)) {
    const file = rel(path);
    const here = moduleOf(file);
    for (const match of readFileSync(path, 'utf8').matchAll(SPECIFIER)) {
      const target = posix.normalize(posix.join(dirname(file), match[2]!));
      if (target.startsWith('..')) continue; // agent/shared 这类 src 之外的
      const owner = moduleOf(target);
      if (owner !== here && target !== `${owner}/index.ts`) found.push(`${file} → ${target}`);
    }
  }
  assert.deepEqual(found, [], '改成从对方的 index.ts 导入；出口缺这个名字就在对方的 index.ts 里补上');
});

test('模块里的文件不引自己的 index.ts：兄弟文件直接引', () => {
  const found: string[] = [];
  for (const path of sourceFiles(SRC)) {
    const file = rel(path);
    const own = `${moduleOf(file)}/index.ts`;
    if (file === own) continue;
    for (const match of readFileSync(path, 'utf8').matchAll(SPECIFIER)) {
      if (posix.normalize(posix.join(dirname(file), match[2]!)) === own) found.push(file);
    }
  }
  assert.deepEqual(found, [], '出口只给别的模块用；自己模块里绕出口会绕成圈');
});

/** 另起一个进程只 import 这一个文件，出错就把第一行错误拿回来。 */
function loadsAlone(path: string): Promise<string | null> {
  const code = `await import(${JSON.stringify(pathToFileURL(path).href)}); process.exit(0);`;
  return new Promise((done) => {
    execFile(process.execPath, ['--input-type=module', '-e', code], { timeout: 60_000 }, (error, _out, err) => {
      done(error ? err.split('\n').find((line) => /Error/.test(line)) ?? String(error) : null);
    });
  });
}

test('每个模块的 index.ts 第一个被加载也不出错（顶层不读还没初始化的别的模块的东西）', async () => {
  const modules = readdirSync(SRC).filter((name) => statSync(join(SRC, name)).isDirectory());
  const failed: string[] = [];
  const queue = [...modules];
  const worker = async (): Promise<void> => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const error = await loadsAlone(join(SRC, name, 'index.ts'));
      if (error !== null) failed.push(`${name}/index.ts：${error}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  assert.deepEqual(failed, [], '把顶层用到别的模块常量的那一句挪进函数里，或者把那个常量放到两边都能直接引的地方');
});
