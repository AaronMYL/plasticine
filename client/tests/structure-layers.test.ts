import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
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

describe('client architectural layers', () => {
  it('prevents lower layers (api, state, primitives) from importing upper layers', () => {
    const found: string[] = [];
    for (const path of sourceFiles(SRC)) {
      const file = rel(path);
      const banned = FORBIDDEN[file.split('/')[0] ?? ''];
      if (banned === undefined) continue;
      for (const match of readFileSync(path, 'utf8').matchAll(SPECIFIER)) {
        const target = posix.normalize(posix.join(dirname(file), match[2]!));
        if (banned.includes(target.split('/')[0] ?? '')) found.push(`${file} -> ${target}`);
      }
    }
    expect(found, 'Move shared dependencies to a lower layer or relocate the importing file upward').toEqual([]);
  });

  it('forbids direct fetch calls inside views, primitives, and state outside api/', () => {
    const found = sourceFiles(SRC).map(rel)
      .filter((file) => /^(views|primitives|state)\//.test(file))
      .filter((file) => readFileSync(join(SRC, file), 'utf8').split('\n')
        .some((line, index, all) => /(?:^\s*|\b(?:await|return|void)\s+|[=(,?:]\s*)fetch\(/.test(line)
          && !(all[index - 1] ?? '').includes('allow-exception:')));
    expect(found).toEqual([]);
  });

  it('keeps test files under client/tests/ rather than client/src/', () => {
    expect(sourceFiles(SRC).map(rel).filter((file) => /\.test\.tsx?$/.test(file))).toEqual([]);
  });
});
