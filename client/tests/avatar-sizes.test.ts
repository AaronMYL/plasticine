import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceFiles } from './source-texts.ts';

const SRC = join(import.meta.dirname, '..', 'src');
const STEPS = new Set([20, 28, 40]);
const EXCEPTIONS: Readonly<Record<string, readonly number[]>> = {
  'shell/rail.tsx': [24],
  'shell/phone-bar.tsx': [26],
  'views/mates/mate-editor.tsx': [52],
  'views/mates/main-identity.tsx': [52],
};

describe('three avatar sizes', () => {
  it('hardcoded avatar sizes are limited to 20, 28, and 40 (except allowlisted cases)', () => {
    const found = sourceFiles(SRC).filter((path) => path.endsWith('.tsx')).flatMap((path) => {
      const name = relative(SRC, path).replaceAll('\\', '/');
      const allowed = EXCEPTIONS[name] ?? [];
      const text = readFileSync(path, 'utf8');
      return [...text.matchAll(/<\w*Avatar\b[^>]*?\bsize=\{(\d+)\}/g)].flatMap((match) => {
        const size = Number(match[1]);
        if (STEPS.has(size) || allowed.includes(size)) return [];
        return [`${name}:${text.slice(0, match.index).split('\n').length} ${size}`];
      });
    });
    expect(found).toEqual([]);
  });
});
