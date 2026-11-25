import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
const ICON_ONLY = new Set(['shell/rail.css']);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'site' ? [] : cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

describe('Accent color is not used for text', () => {
  it('Client styles contain no color: var(--accent)', () => {
    const found = cssFiles(SRC).flatMap((path) => {
      const name = relative(SRC, path).replaceAll('\\', '/');
      if (ICON_ONLY.has(name)) return [];
      return readFileSync(path, 'utf8').split('\n').flatMap((line, index) =>
        /(^|[\s;{])color:\s*var\(--accent\)/.test(line) ? [`${name}:${index + 1} ${line.trim()}`] : []);
    });
    expect(found).toEqual([]);
  });
});
