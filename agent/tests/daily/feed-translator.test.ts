import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFeedTranslator, stripFence } from '../../src/daily/feed-translator.ts';
import { scriptedText } from '../tools/helpers.ts';

test('feed translation uses translate purpose, parses fenced JSON, reports reason on bad reply', async () => {
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
