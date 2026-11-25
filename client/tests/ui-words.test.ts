import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, SCANNED, sourceFiles, uiTexts } from './source-texts.ts';

const BANNED_WORDS = ['碰撞', '先验', '命题', '固执'];
const STANDALONE_W = /(?<![\w\-.$])w(?=\s*(?:[=:：]\s*)?(?:\d|⟨))/u;

function offenders(text: string): string[] {
  const found = BANNED_WORDS.filter((word) => text.includes(word));
  if (STANDALONE_W.test(text)) {
    found.push('w');
  }
  return found;
}

describe('UI copy avoids theoretical jargon', () => {
  it('scanner inspects strings and JSX text only, ignoring comments and regexes', () => {
    const sample = [
      '// 现实碰撞的注释不算',
      "const a = /['\"]命题/;",
      "const label = '来源 · w 1';",
      'const tip = `${name} · w ${weight}`;',
      '/* 先验 */ const node = <p>固执的说明</p>;',
      "const css = 'w-dot'; const size = `${w}px`;",
    ].join('\n');
    const texts = uiTexts(sample);
    expect(texts.flatMap(offenders).sort()).toEqual(['w', 'w', '固执']);
  });

  it('disallowed theoretical terms never appear in UI copy', () => {
    const hits = SCANNED.flatMap(sourceFiles).flatMap((path) => uiTexts(readFileSync(path, 'utf8'))
      .flatMap((text) => offenders(text).map((word) => `${relative(ROOT, path)}：「${word}」在「${text.trim()}」`)));
    expect(hits).toEqual([]);
  });
});
