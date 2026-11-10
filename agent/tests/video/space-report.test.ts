import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { publishVideoSpace, backfillVideoSpaces } from '../../src/video/space-report.ts';
import { writeSpace } from '../../src/subs/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

function summarized() {
  const work = t.state.videoWorks.upsert({ platform: 'douyin', workId: '7300000000000000991',
    url: 'https://www.douyin.com/video/7300000000000000991', title: '示例视频', author: '示例作者',
    collectSeq: 1, collectedAt: null, durationSeconds: 90 }).work;
  return t.state.videoWorks.advance(work.id, { stage: 'summarized', transcript: '[00:00] 这是一份现成逐字稿。',
    digest: { summary: '保持记录，让每次协作可以接续。', outline: ['[00:00] 开场', '[00:30] 记录方法'],
      points: ['把重要决定记在同一个地方。'], related: ['可以把记录和工作放在一起。'] } });
}

test('旧总结补写一份报告空间，时间可点、逐字稿折叠，第二次不再造副本', () => {
  const work = summarized();
  assert.equal(backfillVideoSpaces(t.state), 1);
  const linked = t.state.videoWorks.require(work.id);
  assert.ok(linked.spaceId);
  const space = t.state.spaces.require(linked.spaceId);
  assert.equal(space.genre, 'report');
  assert.equal(space.sourceUrl, work.url);
  assert.match(space.html ?? '', /<details/);
  assert.match(space.html ?? '', /data-seconds="30"/);
  assert.doesNotMatch(space.html ?? '', /收藏于/);
  assert.equal(backfillVideoSpaces(t.state), 0);
  assert.equal(linked.stage, 'summarized');
  assert.equal(linked.transcript, work.transcript);
  assert.equal(t.state.spaces.list().length, 1);
});

test('再次生成更新同一空间，单独改空间后关联仍指向新版', () => {
  const work = summarized();
  const first = publishVideoSpace(t.state, work);
  const second = publishVideoSpace(t.state, { ...t.state.videoWorks.require(work.id),
    digest: { ...work.digest!, summary: '先把重要决定记下来，协作就能接续。' } });
  assert.equal(second.id, first.id);
  assert.ok(second.version > first.version);
  const edited = writeSpace(t.state, { id: second.id, version: second.version, title: second.title,
    html: '<h1>这篇报告已经在资料库中改成了最新版本。</h1>' }, 'user').space;
  backfillVideoSpaces(t.state);
  const id = t.state.videoWorks.require(work.id).spaceId!;
  assert.equal(t.state.spaces.require(id).version, edited.version);
  assert.equal(t.state.spaces.require(id).html, edited.html);
});

test('视频解析把大纲关键帧存成资产并关联空间，重试已总结作品不重新下载转写', async () => {
  const { advanceWork } = await import('../../src/video/pipeline.ts');
  const { dirname } = await import('node:path');
  const calls = { download: 0, transcribe: 0, frames: [] as number[] };
  const work = t.state.videoWorks.upsert({ platform: 'douyin', workId: '7300000000000000992',
    url: 'https://www.douyin.com/video/7300000000000000992', title: '示例视频' }).work;
  t.state.videoWorks.advance(work.id, { resolved: { workId: work.workId, kind: 'video', caption: '',
    videoUrl: 'https://example.com/video.mp4', images: [], subtitles: [], durationSeconds: 90 } });
  const ports = {
    works: t.state.videoWorks, tempRoot: dirname(t.path), now: () => 0, interests: () => [], askMac: () => undefined,
    transcribeLock: async <T>(run: () => Promise<T>) => run(),
    media: {
      download: async () => { calls.download += 1; return 1; }, extractAudio: async () => 90,
      fetchText: async () => '', fetchImage: async () => ({ data: 'aW1hZ2U=', mimeType: 'image/png' }),
      readText: async () => '', webVideo: async () => { throw new Error('不走网页'); },
      extractFrame: async (_file: string, seconds: number) => {
        calls.frames.push(seconds); return { data: 'ZnJhbWU=', mimeType: 'image/png' };
      },
    },
    transcriber: { name: 'fake', transcribe: async () => {
      calls.transcribe += 1;
      return { lines: [{ start: 0, text: '示例逐字稿内容' }], audioSeconds: 90, peakMb: 1, engine: 'fake' };
    } },
    digester: { summarize: async () => ({ summary: '先记录，再展开一次清楚的协作。',
      outline: ['[00:00] 开场', '[00:30] 方法'], points: ['记录重要决定。'], related: [] }),
    readImages: async () => { throw new Error('不读图'); } },
    saveImage: (image: { data: string; mimeType: string }) =>
      t.state.notes.writeAsset(Buffer.from(image.data, 'base64'), image.mimeType).name,
    publish: (row: typeof work) => { publishVideoSpace(t.state, row); },
  };
  await advanceWork(work.id, ports, new AbortController().signal);
  await advanceWork(work.id, ports, new AbortController().signal);
  assert.deepEqual(calls, { download: 1, transcribe: 1, frames: [0, 30] });
  const done = t.state.videoWorks.require(work.id);
  assert.equal(done.digest?.images?.length, 2);
  assert.match(t.state.spaces.require(done.spaceId!).html ?? '', /\/v2\/notes\/assets\/[a-f0-9]+\.png/);
});
