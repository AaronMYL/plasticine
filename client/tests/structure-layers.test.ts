// 界面分层只能往下引（plasticine-code / references/structure.md）：api/ 最底，state/ 在它上面，primitives/ 是通用零件，
// views/ 是页面，shell/ 是把页面装起来的壳。下面的不引上面的；违反了 npm run check 不过。
// 另外：页面取数只经 api/，组件里不直接 fetch 本体的接口；测试文件放 client/tests/，不放在 src/ 里。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
/** 这一层不许引的层。 */
const FORBIDDEN: Readonly<Record<string, readonly string[]>> = {
  api: ['state', 'primitives', 'shell', 'views'],
  state: ['primitives', 'shell', 'views'],
  primitives: ['views'],
};
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const rel = (path: string): string => relative(SRC, path).replaceAll('\\', '/');

describe('界面分层', () => {
  it('api/、state/、primitives/ 不引上面的层', () => {
    const found: string[] = [];
    for (const path of sourceFiles(SRC)) {
      const file = rel(path);
      const banned = FORBIDDEN[file.split('/')[0] ?? ''];
      if (banned === undefined) continue;
      for (const match of readFileSync(path, 'utf8').matchAll(SPECIFIER)) {
        const target = posix.normalize(posix.join(dirname(file), match[2]!));
        if (banned.includes(target.split('/')[0] ?? '')) found.push(`${file} → ${target}`);
      }
    }
    expect(found, '把被引的东西挪到下面那一层，或者把这个文件挪到上面那一层').toEqual([]);
  });

  it('页面和零件里不直接 fetch：取数只经 api/', () => {
    const found = sourceFiles(SRC).map(rel)
      .filter((file) => /^(views|primitives|state)\//.test(file))
      .filter((file) => readFileSync(join(SRC, file), 'utf8').split('\n')
        .some((line, index, all) => /(?:^\s*|\b(?:await|return|void)\s+|[=(,?:]\s*)fetch\(/.test(line)
          && !(all[index - 1] ?? '').includes('例外')));
    expect(found).toEqual([]);
  });

  it('测试文件放 client/tests/，不放在 src/ 里', () => {
    expect(sourceFiles(SRC).map(rel).filter((file) => /\.test\.tsx?$/.test(file))).toEqual([]);
  });
});
