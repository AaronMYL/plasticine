import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { DouyinResolved, VideoDigest } from '../../shared/api/video.ts';
import type { VideoWorkRow } from '../../src/state/index.ts';
import {
  DouyinFavorites,
  publishToFeed,
  resultText,
  VideoWorker,
  type Transcriber,
  type VideoDigester,
  type VideoMedia,
} from '../../src/video/index.ts';
import { publishVideoSpace } from '../../src/video/space-report.ts';
import { videoWorkView } from '../../src/video/douyin.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
let temp: string;
beforeEach(async () => {
  t = await openTestState();
  temp = mkdtempSync(join(tmpdir(), 'video-work-'));
});
afterEach(async () => {
  await t.cleanup();
  rmSync(temp, { recursive: true, force: true });
});

const DIGEST: VideoDigest = { summary: '讲定投的三个误区。', outline: ['[00:00] 开场'], points: ['回撤时停投等于放弃定投'],
  related: ['和你有关：你笔记里记过每月定投'] };

interface Calls {
  summaries: string[];
  images: number;
  downloads: string[];
  transcribed: number;
}

function fakes(options: { transcriber?: boolean; downloadFails?: boolean } = {}) {
  const calls: Calls = { summaries: [], images: 0, downloads: [], transcribed: 0 };
  const digester: VideoDigester = {
    async summarize(input) {
      calls.summaries.push(input.transcript);
      return DIGEST;
    },
    async readImages(input) {
      calls.images += input.images.length;
      return { ...DIGEST, transcript: '图1 定投三原则' };
    },
  };
  const media: VideoMedia = {
    async download(url) {
      calls.downloads.push(url);
      if (options.downloadFails === true) throw new Error('远程服务器回了 403。');
      return 1000;
    },
    async extractAudio() { return 222; },
    async fetchText() { return '1\n00:00:01,000 --> 00:00:02,000\n自带字幕第一句\n'; },
    async fetchImage() { return { data: 'aGk=', mimeType: 'image/jpeg' }; },
    async readText() { return ''; },
    async webVideo() { return { video: join(temp, 'media.m4a'), subtitles: [], title: 'web', caption: '',
      durationSeconds: 60, author: null }; },
  };
  const transcriber: Transcriber = {
    name: 'fake:small',
    async transcribe() {
      calls.transcribed += 1;
      return { lines: [{ start: 0, text: '本地转写第一句' }], audioSeconds: 222, peakMb: 512, engine: 'fake' };
    },
  };
  return { calls, digester, media, transcriber: options.transcriber === false ? null : transcriber, real: transcriber };
}

function setup(options: { transcriber?: boolean; downloadFails?: boolean; slots?: () => number } = {}) {
  const parts = fakes(options);
  const summarized: VideoWorkRow[] = [];
  let transcriber = parts.transcriber;
  const worker = new VideoWorker({ state: t.state, slots: options.slots ?? (() => 3),
    summarized: (work) => summarized.push(work),
    ports: { media: parts.media, digester: parts.digester, transcriber: () => transcriber, interests: () => ['理财'],
      tempRoot: temp, now: () => Date.now(),
      saveImage: (image) => t.state.notes.writeAsset(Buffer.from(image.data, 'base64'), image.mimeType).name,
      publish: (work) => { publishVideoSpace(t.state, work); } } });
  const douyin = new DouyinFavorites({ state: t.state, worker, now: () => new Date() });
  /** 装好本地转写。 */
  const install = (): void => { transcriber = parts.real; };
  return { ...parts, worker, douyin, summarized, install };
}

function listed(workId: string, caption = '') {
  return t.state.videoWorks.upsert({ platform: 'douyin', workId, url: `https://www.douyin.com/video/${workId}`,
    title: '普通人做指数定投的三个误区', caption, author: '理财小课堂', collectedAt: '2026-11-06T08:00:00.000Z' }).work;
}

const RESOLVED = (workId: string, patch: Partial<DouyinResolved> = {}): DouyinResolved => ({ workId, kind: 'video',
  caption: '定投的三个误区 #理财', videoUrl: 'https://v3-web.douyinvod.com/x/video.mp4', images: [], subtitles: [],
  durationSeconds: 222, ...patch });

test('抖音视频不先看标题配文：直接排给 Mac 取地址、停在等 Mac；交回后下载转写，自带字幕也不用', async () => {
  const s = setup();
  const work = listed('7300000000000000002', '三个误区：一、回撤停投；二、只看年化；三、频繁换基金。');
  assert.equal(s.douyin.process({ ids: [work.id] }).queued, 1);
  await s.worker.settled();
  assert.equal(t.state.videoWorks.require(work.id).stage, 'synced');
  assert.equal(t.state.videoWorks.require(work.id).run, 'waiting_mac');
  const [job] = s.douyin.jobs();
  assert.deepEqual(job, { id: job?.id, kind: 'resolve', workId: '7300000000000000002',
    url: 'https://www.douyin.com/video/7300000000000000002' });
  const subtitles = [{ lang: 'zh', url: 'https://example.com/sub.srt', format: 'srt' as const }];
  assert.deepEqual(s.douyin.report({ requestId: 'report-0001', jobId: job!.id,
    resolved: RESOLVED('7300000000000000002', { subtitles }) }), { accepted: true, added: 0 });
  await s.worker.settled();
  const done = t.state.videoWorks.require(work.id);
  assert.equal(done.stage, 'summarized');
  assert.equal(done.transcriptSource, 'local');
  assert.equal(done.caption, '定投的三个误区 #理财');
  assert.deepEqual(s.calls.downloads, ['https://v3-web.douyinvod.com/x/video.mp4']);
  assert.deepEqual(s.calls.summaries, ['[00:00] 本地转写第一句']);
  assert.match(resultText(done), /核心观点：\n- 回撤时停投/);
  assert.deepEqual(s.douyin.report({ requestId: 'report-0002', jobId: job!.id,
    resolved: RESOLVED('7300000000000000002') }), { accepted: false, added: 0 }, '交过的活不再动');
  const item = publishToFeed(t.state, done, new Date('2026-11-07T08:00:00.000Z'), 'Asia/Shanghai');
  assert.equal(item?.title, '普通人做指数定投的三个误区');
  assert.equal(publishToFeed(t.state, t.state.videoWorks.require(work.id), new Date(), 'Asia/Shanghai'), null);
  assert.equal(t.state.videoWorks.require(work.id).feedItemId, item?.id);
  assert.equal(s.douyin.process({ ids: [work.id] }).queued, 0, '处理过的不重复');
});

test('没做成的抖音作品重来：丢掉过期的下载地址，排给 Mac 重新取', async () => {
  const s = setup({ downloadFails: true });
  const work = listed('7300000000000000008');
  t.state.videoWorks.advance(work.id, { resolved: RESOLVED('7300000000000000008') });
  s.douyin.process({ ids: [work.id] });
  await s.worker.settled();
  assert.equal(t.state.videoWorks.require(work.id).run, 'failed');
  assert.equal(s.douyin.process({ ids: [work.id] }).queued, 1);
  await s.worker.settled();
  const again = t.state.videoWorks.require(work.id);
  assert.equal(again.resolved, null);
  assert.equal(again.run, 'waiting_mac');
  const [job] = s.douyin.jobs();
  assert.equal(job?.kind === 'resolve' ? job.workId : null, '7300000000000000008');
});

test('没有字幕：在本机下载、抽音频、本地转写，记下耗时和峰值内存', async () => {
  const s = setup();
  const work = listed('7300000000000000003');
  t.state.videoWorks.advance(work.id, { resolved: RESOLVED('7300000000000000003') });
  s.douyin.process({ ids: [work.id] });
  await s.worker.settled();
  const done = t.state.videoWorks.require(work.id);
  assert.equal(done.stage, 'summarized');
  assert.equal(done.transcriptSource, 'local');
  assert.equal(done.timing?.engine, 'fake:small');
  assert.equal(done.timing?.peakMb, 512);
  assert.equal(done.timing?.audioSeconds, 222);
  assert.deepEqual(s.calls.downloads, ['https://v3-web.douyinvod.com/x/video.mp4']);
});

test('图文作品：读图里的文字，结合配文总结', async () => {
  const s = setup();
  const work = listed('7300000000000000004');
  t.state.videoWorks.advance(work.id, { resolved: RESOLVED('7300000000000000004', { kind: 'images', videoUrl: null,
    images: ['https://p3.douyinpic.com/a.jpg', 'https://p3.douyinpic.com/b.jpg'] }) });
  s.douyin.process({ ids: [work.id] });
  await s.worker.settled();
  const done = t.state.videoWorks.require(work.id);
  assert.equal(done.transcriptSource, 'images');
  assert.equal(done.transcript, '图1 定投三原则');
  assert.equal(s.calls.images, 2);
  assert.equal(done.kind, 'images');
  assert.equal(done.digest?.images?.length, 2);
  assert.ok(done.digest?.images?.every((image) => image.seconds === null));
  assert.match(t.state.spaces.require(done.spaceId!).html ?? '', /原图 1/);
});

test('没装本地转写：视频不取地址、不下载，停在「等转写装好」；装好以后自动接着走', async () => {
  const s = setup({ transcriber: false });
  const known = t.state.videoWorks.advance(listed('7300000000000000005').id, { kind: 'video' });
  const resolved = listed('7300000000000000015');
  t.state.videoWorks.advance(resolved.id, { resolved: RESOLVED('7300000000000000015') });
  s.douyin.process({ ids: [known.id, resolved.id] });
  await s.worker.settled();
  for (const id of [known.id, resolved.id]) {
    const row = t.state.videoWorks.require(id);
    assert.deepEqual([row.run, row.want, row.stage, row.error], ['idle', 'full', 'synced', null]);
    assert.equal(videoWorkView(row).run, 'waiting_transcriber');
  }
  assert.deepEqual(s.calls.downloads, [], '没装转写不下载视频');
  assert.deepEqual(s.douyin.jobs(), [], '知道是视频的不让电脑去取地址');
  assert.match(resultText(t.state.videoWorks.require(known.id)), /要先装本地转写/);
  s.install();
  assert.equal(s.worker.resumeTranscribing(), 2);
  await s.worker.settled();
  assert.equal(t.state.videoWorks.require(resolved.id).stage, 'summarized');
  assert.equal(t.state.videoWorks.require(known.id).run, 'waiting_mac', '装好以后先让电脑取地址');
  assert.deepEqual(s.calls.downloads, ['https://v3-web.douyinvod.com/x/video.mp4']);
});

test('图文作品不用转写：没装也照常解析', async () => {
  const s = setup({ transcriber: false });
  const work = listed('7300000000000000016');
  t.state.videoWorks.advance(work.id, { resolved: RESOLVED('7300000000000000016', { kind: 'images', videoUrl: null,
    images: ['https://p3.douyinpic.com/a.jpg'] }) });
  s.douyin.process({ ids: [work.id] });
  await s.worker.settled();
  assert.equal(t.state.videoWorks.require(work.id).stage, 'summarized');
});

test('Mac 没登录：等 Mac 的那条记原因', async () => {
  const s = setup();
  const other = listed('7300000000000000006');
  s.douyin.process({ ids: [other.id] });
  await s.worker.settled();
  const [job] = s.douyin.jobs();
  s.douyin.report({ requestId: 'report-0003', jobId: job!.id, error: { code: 'signed_out' } });
  assert.match(t.state.videoWorks.require(other.id).error ?? '', /没登录/);
});

test('排进后台线的并发上限：没有空位时不开工，有了再接着走', async () => {
  let free = 0;
  const s = setup({ slots: () => free });
  const work = listed('7300000000000000007');
  t.state.videoWorks.advance(work.id, { resolved: RESOLVED('7300000000000000007') });
  s.douyin.process({ ids: [work.id] });
  await s.worker.settled();
  assert.equal(t.state.videoWorks.require(work.id).run, 'queued');
  free = 1;
  s.worker.kick();
  await s.worker.settled();
  assert.equal(t.state.videoWorks.require(work.id).stage, 'summarized');
  assert.equal(s.summarized.length, 1);
});

test('同步：排给 Mac 翻收藏；交回按作品 ID 去重，done 才算同步完', async () => {
  const s = setup();
  assert.equal(s.douyin.sync().state, 'waiting_mac');
  listed('7300000000000000010');
  const [job] = s.douyin.jobs();
  assert.equal(job?.kind, 'list');
  assert.deepEqual(job?.kind === 'list' ? job.sinceIds : [], ['7300000000000000010']);
  assert.equal(s.douyin.syncView().state, 'running');
  const works = [{ workId: '7300000000000000011', title: '30 天把英语听力练到能看美剧', caption: '', author: '英语阿卡',
    kind: 'video' as const, durationSeconds: 95, collectedAt: '2026-11-04T08:00:00.000Z', folderIds: ['f1'] }];
  const folders = [{ id: 'f1', name: '学习', count: 12 }];
  assert.equal(s.douyin.report({ requestId: 'list-0001', jobId: job!.id, list: { folders, works, done: false } }).added,
    1);
  assert.equal(s.douyin.report({ requestId: 'list-0002', jobId: job!.id, list: { folders, works, done: true } }).added,
    0);
  const view = s.douyin.list({}, 50, 0);
  assert.equal(view.total, 2);
  assert.equal(view.sync.state, 'idle');
  assert.notEqual(view.sync.lastAt, null);
  assert.deepEqual(view.folders, folders);
  assert.equal(s.douyin.list({ folder: 'f1' }, 50, 0).works[0]?.title, '30 天把英语听力练到能看美剧');
  assert.equal(view.macOnline, false);
});

test('哪台电脑在线都算：Windows 的桌面客户端在线，就不写「等电脑上线」；手机和网页不算', () => {
  const s = setup();
  const at = new Date().toISOString();
  let seq = 0;
  const node = (platform: 'windows' | 'ios' | 'browser', name: string) => t.state.nodes.create({ name, platform,
    appVersion: '2026.1112.1', protocolVersion: 1, capabilities: [], credentialHash: String(seq += 1).repeat(64),
    pairingCodeId: `code-${name}`, pairedAt: at, lastSeenAt: at });
  node('ios', '手机');
  node('browser', '网页');
  assert.equal(s.douyin.list({}, 50, 0).macOnline, false);
  node('windows', '书房的电脑');
  assert.equal(s.douyin.list({}, 50, 0).macOnline, true);
});
