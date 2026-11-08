// 第 5 批「界面用词收尾」（《置信度与做事方式改动方案》）：理论里的词不进界面。扫客户端源码和两端共用的
// agent/shared 里的字符串和 JSX 文字（不扫注释、测试和假接口的示例数据），碰撞、先验、命题、固执不准出现，
// 当权重讲的独立 w（「w 1」「w 0.5」「w=…」「· w …」）也不准出现。

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

describe('界面文案不用理论词', () => {
  it('扫描器只看字符串和 JSX 文字，注释和正则不算', () => {
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

  it('碰撞、先验、命题、固执、当权重讲的 w 不出现在界面文案里', () => {
    const hits = SCANNED.flatMap(sourceFiles).flatMap((path) => uiTexts(readFileSync(path, 'utf8'))
      .flatMap((text) => offenders(text).map((word) => `${relative(ROOT, path)}：「${word}」在「${text.trim()}」`)));
    expect(hits).toEqual([]);
  });
});
