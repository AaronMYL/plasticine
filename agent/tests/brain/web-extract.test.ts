import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { extractWebPage, prepareWebArchive, publishWebArchive } from '../../src/brain/web-extract.ts';
import { scriptedText } from './helpers.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });
const input = { url: 'https://example.com/walk#section', title: '城市散步',
  text: '导航\n城市散步\n先沿河走，再进公园。\n广告推荐内容。\n回程走另一条路。',
  totalChars: 42, truncated: false,
  images: [{ url: 'https://example.com/river.png', alt: '河边小路', afterText: '先沿河走，再进公园。' }] };
const answer = JSON.stringify({ keptBlocks: [0, 2], points: [{ text: '沿河进入公园', block: 0, quote: '先沿河走，再进公园。' }] });
const signal = () => new AbortController().signal;

test('提取只使用阅读模式正文，去掉广告，重点必须能对应真实原文；空正文不发模型', async () => {
  const model = scriptedText([answer]);
  const result = await extractWebPage(model.models, input, signal());
  assert.deepEqual(result.blocks.map((b) => b.text), ['先沿河走，再进公园。', '回程走另一条路。']);
  assert.equal(result.points[0]?.quote, '先沿河走，再进公园。');
  assert.equal(result.url, 'https://example.com/walk');
  await assert.rejects(extractWebPage(model.models, { ...input, text: '' }, signal()), /正文/);
  assert.equal(model.requests.length, 1);
  const bad = scriptedText([JSON.stringify({ keptBlocks: [0], points: [{ text: '伪造', block: 0, quote: '河边有咖啡馆' }] })]);
  await assert.rejects(extractWebPage(bad.models, input, signal()), /原文/);
});

test('归档写阅读正文和本地图片，同一网址更新原空间，保留来源元数据和版本', async () => {
  const model = scriptedText([answer]);
  const result = await extractWebPage(model.models, input, signal());
  const prepared = await prepareWebArchive(result,
    async () => ({ data: Buffer.from('image'), type: 'image/png' }), signal());
  const first = publishWebArchive(t.state, prepared, new Date('2026-11-11T08:00:00Z'));
  assert.equal(first.category, 'webarchive');
  assert.match(first.html!, /<mark>先沿河走，再进公园。<\/mark>/);
  assert.match(first.html!, /\/v2\/notes\/assets\//);
  assert.doesNotMatch(first.html!, /广告推荐内容|src="https:/);
  const second = publishWebArchive(t.state, { ...prepared, points: [] }, new Date('2026-11-11T09:00:00Z'));
  assert.equal(second.id, first.id);
  assert.equal(second.version, first.version + 1);
  assert.equal(t.state.spaces.list().length, 1);
});

test('已回收或永久清空的同网址归档不自动恢复或另造副本，图片失败不写空间', async () => {
  const result = await extractWebPage(scriptedText([answer]).models, input, signal());
  await assert.rejects(prepareWebArchive(result, async () => { throw new Error('图片读不到'); }, signal()), /图片/);
  assert.equal(t.state.spaces.list().length, 0);
  const prepared = await prepareWebArchive({ ...result, images: [] },
    async () => { throw new Error('不应下载'); }, signal());
  const page = publishWebArchive(t.state, prepared, new Date());
  t.state.spaces.markDeleted(page.id, page.version);
  assert.throws(() => publishWebArchive(t.state, prepared, new Date()), /删除/);
  t.state.libraryPurge.space(page.id);
  assert.throws(() => publishWebArchive(t.state, prepared, new Date()), /删除/);
  assert.equal(t.state.spaces.list().length, 0);
  assert.equal(t.state.spaces.findBySourceUrl(result.url, 'webarchive', true)?.id, page.id);
});
