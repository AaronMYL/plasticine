import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFeedTranslator, stripFence } from '../../src/brain/feed-translator.ts';
import { scriptedText } from './helpers.ts';

test('信息流翻译走「翻译」用途，解析 JSON（含代码块包着的），坏回复给出原因', async () => {
  const reply = '```json\n{"lang":"en","title":"标题","text":"正文","digest":null,"chart":null}\n```';
  const fake = scriptedText([reply, 'not json']);
  const translate = createFeedTranslator(fake.models);
  const input = { title: 'Title', text: 'Body', site: 'example.com', post: false };
  assert.deepEqual(await translate(input, AbortSignal.timeout(1000)),
    { lang: 'en', title: '标题', text: '正文', digest: null, chart: null });
  assert.equal(fake.requests[0]?.purpose, 'translation');
  await assert.rejects(translate(input, AbortSignal.timeout(1000)), /JSON/);
  assert.equal(stripFence(' {"a":1} '), '{"a":1}');
});
