import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sourceFiles } from './source-texts.ts';

const SIZES = [12, 14, 16, 20];
const ICON_SIZE = /<(Icon|IconButton)\b(?:[^<>]|=>)*?size=\{(\d+)\}/gs;

function offenders(source: string): string[] {
  return [...source.matchAll(ICON_SIZE)].filter((match) => !SIZES.includes(Number(match[2])))
    .map((match) => `${match[1]} size=${match[2]}`);
}

describe('four icon size tiers', () => {
  it('scanner detects icon sizes passed to components', () => {
    expect(offenders('<Icon name="clock" size={13} />\n<IconButton icon="more"\n  label="更多" size={16} />'))
      .toEqual(['Icon size=13']);
  });

  it('client icons use only sizes 12, 14, 16, and 20', () => {
    const hits = sourceFiles(join(ROOT, 'client', 'src')).filter((path) => path.endsWith('.tsx'))
      .flatMap((path) => offenders(readFileSync(path, 'utf8')).map((hit) => `${relative(ROOT, path)}：${hit}`));
    expect(hits).toEqual([]);
  });
});
