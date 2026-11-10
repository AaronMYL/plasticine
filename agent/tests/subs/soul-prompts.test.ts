import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPORT_GUIDE, LETTER_GUIDE, SPACE_RULES } from '../../src/subs/space-guide.ts';
import { RESEARCH_SECTIONS } from '../../src/subs/defaults.ts';
import { TALK_STYLE, BACKGROUND_HANDOFF } from '../../src/lines/talk-style.ts';
import { MAIN_SOUL_DEFAULTS } from '../../shared/soul.ts';

test('报告、来信、交接和对话提示直接讲内容；保留准确来源与结果字段', () => {
  assert.match(REPORT_GUIDE, /<dt>要点<\/dt>/);
  assert.doesNotMatch(REPORT_GUIDE, /不能读成|<\/i>支持<\/dt>/);
  assert.deepEqual(RESEARCH_SECTIONS, ['本周概览', '重点研究', '研究方法', '和你兴趣相关的发现', '值得继续追踪的问题']);
  assert.match(TALK_STYLE, /真有影响判断的不确定，在那一句旁边简短说一句/);
  assert.doesNotMatch(TALK_STYLE, /拿不准的直接说/);
  for (const prompt of [REPORT_GUIDE, LETTER_GUIDE, TALK_STYLE, BACKGROUND_HANDOFF]) {
    assert.doesNotMatch(prompt, /加.{0,4}免责声明|写.{0,4}边界声明|仅供参考|不代表.{0,6}建议/);
  }
  assert.match(SPACE_RULES, /不编数据/);
  assert.match(BACKGROUND_HANDOFF, /done.*真的做成了才写 true/);
  assert.ok(MAIN_SOUL_DEFAULTS.some((line) => line.text.includes('不写边界声明和免责声明')));
});
