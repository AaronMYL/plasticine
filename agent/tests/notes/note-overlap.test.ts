import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leadingOverlap, overlapUndecided, PredictText, trailingOverlap } from '../../src/notes/note-overlap.ts';

function streamed(before: string, after: string, deltas: string[]): { sent: string[]; final: string } {
  const shaping = new PredictText(before, after);
  const sent = deltas.map((delta) => shaping.push(delta));
  return { sent, final: shaping.finish(deltas.join('')) };
}

test('Strips leading characters duplicating text immediately before cursor', () => {
  assert.equal(leadingOverlap('我今天想去', '想去公园散步'), 2);
  assert.equal(leadingOverlap('把事实记清楚，然后', '然后再对一遍'), 2);
  assert.equal(leadingOverlap('正在记录这段经历', '正在记录这段经历，然后把事实记清楚。'), 8);
  assert.equal(leadingOverlap('I want to', 'to go home'), 2);
});

test('Single-character overlap is not treated as duplicate except punctuation/spaces', () => {
  assert.equal(leadingOverlap('我们可以试', '试看'), 0);
  assert.equal(leadingOverlap('天', '天天向上'), 0);
  assert.equal(leadingOverlap('这件事做完了。', '。接下来'), 1);
  assert.equal(leadingOverlap('他说：“', '“你好”'), 1);
  assert.equal(leadingOverlap('Hello ', ' world'), 1);
});

test('ASCII alphanumeric overlap requires word boundary; mid-word matches stay intact', () => {
  assert.equal(leadingOverlap('the cat', 'at home'), 0);
  assert.equal(leadingOverlap('I want to', 'tomorrow'), 0);
  assert.equal(leadingOverlap('版本 12', '123'), 0);
  assert.equal(leadingOverlap('the cat', 'cat sat'), 3);
});

test('Strips trailing overlap with post-cursor text, comparing next line after newline', () => {
  assert.equal(trailingOverlap('，然后把事实记清楚。后文已写好', '\n后文已写好的结论。'), 5);
  assert.equal(trailingOverlap('先把证据列出来', '列出来以后再说'), 3);
  assert.equal(trailingOverlap('写到这里', '里面还有'), 0);
  assert.equal(trailingOverlap('，接着写', ''), 0);
});

test('Holds back tentative prefix while it may match longer pre-cursor suffix', () => {
  assert.equal(overlapUndecided('我今天想去', ''), true);
  assert.equal(overlapUndecided('我今天想去', '今'), true);
  assert.equal(overlapUndecided('我今天想去', '今天'), true);
  assert.equal(overlapUndecided('我今天想去', '去'), false);
  assert.equal(overlapUndecided('我今天想去', '公'), false);
});

test('Streaming holds overlapping prefix and emits only new chars matching final text', () => {
  const result = streamed('我今天想去', '', ['想', '去', '公园', '散步。']);
  assert.deepEqual(result.sent, ['', '', '公园', '散步。']);
  assert.equal(result.final, '公园散步。');
});

test('Emits first character immediately without delay when there is no overlap', () => {
  const result = streamed('正在记录这段经历', '', ['，然', '后把', '事实记清楚。']);
  assert.deepEqual(result.sent.map((part) => part !== ''), [true, true, true]);
  assert.equal(result.sent.join(''), '，然后把事实记清楚。');
  assert.equal(result.final, '，然后把事实记清楚。');
});

test('Trims quotes and trailing spaces; strips post-cursor overlap in final text', () => {
  const result = streamed('前文', '\n后文已写好的结论。', ['“接着', '写一句。后文已写好', '”\n']);
  assert.equal(result.sent.join(''), '接着写一句。后文已写好”\n');
  assert.equal(result.final, '接着写一句。');
});

test('Fully duplicated generation emits nothing and resolves to empty string', () => {
  const result = streamed('把事实记清楚', '', ['把事实', '记清楚']);
  assert.deepEqual(result.sent, ['', '']);
  assert.equal(result.final, '');
});

test('Non-streaming full-text model response applies identical deduplication rules', () => {
  const shaping = new PredictText('我今天想去', '');
  assert.equal(shaping.finish('想去公园散步。  '), '公园散步。');
});
