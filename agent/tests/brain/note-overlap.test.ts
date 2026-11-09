// 续写收下前去重（2026-11-09 他定）：开头和光标前末尾重叠、结尾和光标后开头重叠的部分在送出之前去掉；
// 边生成边送时，开头还可能是重叠的先压着，能判断了再放。判断保守：宁漏勿错。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leadingOverlap, overlapUndecided, PredictText, trailingOverlap } from '../../src/brain/note-overlap.ts';

function streamed(before: string, after: string, deltas: string[]): { sent: string[]; final: string } {
  const shaping = new PredictText(before, after);
  const sent = deltas.map((delta) => shaping.push(delta));
  return { sent, final: shaping.finish(deltas.join('')) };
}

test('开头重复了光标前的几个字：去掉重复的部分', () => {
  assert.equal(leadingOverlap('我今天想去', '想去公园散步'), 2);
  assert.equal(leadingOverlap('把事实记清楚，然后', '然后再对一遍'), 2);
  assert.equal(leadingOverlap('正在记录这段经历', '正在记录这段经历，然后把事实记清楚。'), 8);
  assert.equal(leadingOverlap('I want to', 'to go home'), 2);
});

test('一个字的重合不算重复（「试」+「试看」），标点和空白除外', () => {
  assert.equal(leadingOverlap('我们可以试', '试看'), 0);
  assert.equal(leadingOverlap('天', '天天向上'), 0);
  assert.equal(leadingOverlap('这件事做完了。', '。接下来'), 1);
  assert.equal(leadingOverlap('他说：“', '“你好”'), 1);
  assert.equal(leadingOverlap('Hello ', ' world'), 1);
});

test('英文和数字的重合要落在词边界上，词中间碰巧一样不算', () => {
  assert.equal(leadingOverlap('the cat', 'at home'), 0);
  assert.equal(leadingOverlap('I want to', 'tomorrow'), 0);
  assert.equal(leadingOverlap('版本 12', '123'), 0);
  assert.equal(leadingOverlap('the cat', 'cat sat'), 3);
});

test('结尾重复了光标后已经写好的开头：去掉；光标后先换行的按下一段开头比', () => {
  assert.equal(trailingOverlap('，然后把事实记清楚。后文已写好', '\n后文已写好的结论。'), 5);
  assert.equal(trailingOverlap('先把证据列出来', '列出来以后再说'), 3);
  assert.equal(trailingOverlap('写到这里', '里面还有'), 0);
  assert.equal(trailingOverlap('，接着写', ''), 0);
});

test('生成到一半：开头还可能是光标前更长一段的开头时先压着', () => {
  assert.equal(overlapUndecided('我今天想去', ''), true);
  assert.equal(overlapUndecided('我今天想去', '今'), true);
  assert.equal(overlapUndecided('我今天想去', '今天'), true);
  assert.equal(overlapUndecided('我今天想去', '去'), false);
  assert.equal(overlapUndecided('我今天想去', '公'), false);
});

test('边生成边送：重复的开头压着不送，判断出来后只送新的字；最终文字和送出的开头一致', () => {
  const result = streamed('我今天想去', '', ['想', '去', '公园', '散步。']);
  assert.deepEqual(result.sent, ['', '', '公园', '散步。']);
  assert.equal(result.final, '公园散步。');
});

test('不重复时第一个字就送出去，不白等', () => {
  const result = streamed('正在记录这段经历', '', ['，然', '后把', '事实记清楚。']);
  assert.deepEqual(result.sent.map((part) => part !== ''), [true, true, true]);
  assert.equal(result.sent.join(''), '，然后把事实记清楚。');
  assert.equal(result.final, '，然后把事实记清楚。');
});

test('引号和结尾空白照旧收拾；结尾和光标后重复的在最终文字里去掉', () => {
  const result = streamed('前文', '\n后文已写好的结论。', ['“接着', '写一句。后文已写好', '”\n']);
  assert.equal(result.sent.join(''), '接着写一句。后文已写好”\n');
  assert.equal(result.final, '接着写一句。');
});

test('整段都是重复的：什么也不送，最终是空', () => {
  const result = streamed('把事实记清楚', '', ['把事实', '记清楚']);
  assert.deepEqual(result.sent, ['', '']);
  assert.equal(result.final, '');
});

test('模型不流式（一次给全文）也按同样规则去重', () => {
  const shaping = new PredictText('我今天想去', '');
  assert.equal(shaping.finish('想去公园散步。  '), '公园散步。');
});
