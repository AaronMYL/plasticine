import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { shortVideoTitle, type DouyinListedWork } from '../../shared/api/video.ts';
import { DouyinFavorites } from '../../src/video/douyin.ts';
import { openState } from '../../src/state/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
let kicks: number;
function favorites(state = t.state): DouyinFavorites {
  return new DouyinFavorites({ state, worker: { kick: () => { kicks += 1; }, macFailed: () => undefined,
    resolved: () => null }, now: () => new Date('2026-11-11T08:00:00.000Z') });
}
function listed(index: number, position = index): DouyinListedWork {
  return { workId: String(7300000000000000000n + BigInt(index)), title: `作品 ${index}`, caption: '',
    author: '示例作者', kind: 'video', durationSeconds: null, collectedAt: null, publishedAt: null,
    folderIds: [], listPosition: position };
}
beforeEach(async () => { t = await openTestState(); kicks = 0; });
afterEach(async () => { await t.cleanup(); });

test('全量回填跨批次、重启仍保留顺序，已有作品不重复解析、不改阶段', () => {
  const works = Array.from({ length: 1_005 }, (_, index) => listed(index));
  for (const work of works) {
    const row = t.state.videoWorks.upsert({ ...work, platform: 'douyin',
      url: `https://www.douyin.com/video/${work.workId}` });
    t.state.videoWorks.advance(row.work.id, { stage: 'summarized', transcript: '原逐字稿' });
  }
  let service = favorites();
  service.sync(true);
  const job = service.jobs()[0]!;
  assert.equal(job.kind, 'list');
  assert.equal(job.kind === 'list' && job.full, true);
  const first = service.report({ requestId: 'order-part-1', jobId: job.id,
    list: { folders: [], works: works.slice(0, 200), done: false } });
  assert.equal(first.added, 0);
  t.close();
  const reopened = openState({ path: t.path });
  try {
    service = favorites(reopened);
    for (let start = 200; start < works.length; start += 200) {
      service.report({ requestId: `order-part-${start}`, jobId: job.id,
        list: { folders: [], works: works.slice(start, start + 200), done: start + 200 >= works.length } });
    }
    const page = reopened.videoWorks.page({ platform: 'douyin' }, 2_000, 0);
    assert.deepEqual(page.works.map((work) => work.workId), works.map((work) => work.workId));
    assert.ok(page.works.every((work) => work.stage === 'summarized' && work.run === 'idle'
      && work.transcript === '原逐字稿' && work.collectedAt === null));
    assert.equal(kicks, 0);
    assert.deepEqual(service.jobs(), []);
    const before = page.works[0]?.collectSeq;
    assert.deepEqual(service.report({ requestId: 'late-retry', jobId: job.id,
      list: { folders: [], works: [listed(0, 99)], done: true } }), { accepted: false, added: 0 });
    assert.equal(reopened.videoWorks.page({ platform: 'douyin' }, 1, 0).works[0]?.collectSeq, before);
  } finally { reopened.close(); }
});

test('新一轮增量作品按列表顺序置顶，不按发布时间或批次到达时间排', () => {
  const service = favorites();
  service.sync();
  const first = service.jobs()[0]!;
  service.report({ requestId: 'old-list', jobId: first.id,
    list: { folders: [], works: [listed(1, 0)], done: true } });
  service.sync();
  const second = service.jobs()[0]!;
  service.report({ requestId: 'new-list-a', jobId: second.id,
    list: { folders: [], works: [listed(3, 0)], done: false } });
  service.report({ requestId: 'new-list-b', jobId: second.id,
    list: { folders: [], works: [listed(2, 1)], done: true } });
  assert.deepEqual(service.list({}, 10, 0).works.map((work) => work.title), ['作品 3', '作品 2', '作品 1']);
});

test('已做完全量后，抖音不再返回的历史作品不会导致每次同步都全量', () => {
  t.state.videoWorks.upsert({ ...listed(1), platform: 'douyin', url: 'https://example.com/video' });
  const service = favorites();
  service.sync();
  const full = service.jobs()[0]!;
  assert.equal(full.kind === 'list' && full.full, true);
  service.report({ requestId: 'full-empty', jobId: full.id, list: { folders: [], works: [], done: true } });
  service.sync();
  const next = service.jobs()[0]!;
  assert.equal(next.kind === 'list' && next.full, false);
  assert.equal(t.state.videoWorks.page({ platform: 'douyin' }, 10, 0).total, 1);
});

test('新全量先回传时旧任务不改它的排序，同一任务重取后可以更正位置', () => {
  const service = favorites();
  service.sync();
  const old = service.jobs()[0]!;
  service.sync(true);
  const full = service.jobs().find((job) => job.id !== old.id)!;
  service.report({ requestId: 'new-first', jobId: full.id,
    list: { folders: [], works: [listed(1, 0)], done: false } });
  service.report({ requestId: 'old-late', jobId: old.id,
    list: { folders: [], works: [listed(1, 9)], done: true } });
  const before = t.state.videoWorks.byWork('douyin', listed(1).workId)!.collectSeq!;
  service.report({ requestId: 'new-retried', jobId: full.id,
    list: { folders: [], works: [listed(2, 0), listed(1, 1)], done: true } });
  const page = t.state.videoWorks.page({ platform: 'douyin' }, 10, 0);
  assert.deepEqual(page.works.map((work) => work.title), ['作品 2', '作品 1']);
  assert.equal(page.works[1]?.collectSeq, before - 1);
});

test('收藏时间只取报告里的真实字段；发布时间、同步钟和旧历史日期不替代它', () => {
  const oldDate = '2025-04-03T08:00:00.000Z';
  const trueDate = '2026-09-17T12:10:00.000Z';
  const historical = t.state.videoWorks.upsert({ platform: 'douyin', ...listed(1),
    url: 'https://www.douyin.com/video/7300000000000000001', collectedAt: oldDate }).work;
  const service = favorites();
  assert.equal(service.list({}, 10, 0).works[0]?.collectedAt, null, '旧字段没有收藏来源证明，读时隐藏');
  service.sync(true);
  const job = service.jobs()[0]!;
  service.report({ requestId: 'date-provenance', jobId: job.id, list: { folders: [], works: [
    { ...listed(1, 0), publishedAt: '2026-01-01T00:00:00.000Z', collectedAt: null },
    { ...listed(2, 1), publishedAt: '2026-02-01T00:00:00.000Z', collectedAt: trueDate },
  ], done: true } });
  const list = service.list({}, 10, 0);
  assert.deepEqual(list.works.map((work) => [work.workId, work.collectedAt]), [
    [listed(1).workId, null], [listed(2).workId, trueDate],
  ]);
  assert.equal(t.state.videoWorks.require(historical.id).collectedAt, null, '全量核实时清掉历史替代日期');
  assert.notEqual(list.works[1]?.collectedAt, list.sync.lastAt);
  assert.notEqual(list.works[1]?.collectedAt, t.state.videoWorks.byWork('douyin', listed(2).workId)?.createdAt);
});

test('封面和短标题（11-11）：同步记下封面、下次同步换新地址；长描述只取第一句、去掉话题', () => {
  const service = favorites();
  service.sync(true);
  const job = service.jobs()[0]!;
  const long = '普通人做指数定投的三个误区，第一个就是跌了就停。后面还有很长的一段解释 #理财 #定投';
  service.report({ requestId: 'cover-1', jobId: job.id, list: { folders: [], done: false, works: [
    { ...listed(1), title: '', caption: long, coverUrl: 'https://p3.example.com/cover-a.jpg' }] } });
  const [work] = service.list({}, 50, 0).works;
  assert.equal(work!.coverUrl, 'https://p3.example.com/cover-a.jpg');
  assert.equal(work!.title, '普通人做指数定投的三个误区，第一个就是跌了就停。');
  service.report({ requestId: 'cover-2', jobId: job.id, list: { folders: [], done: true, works: [
    { ...listed(1), coverUrl: 'https://p3.example.com/cover-b.jpg' }] } });
  assert.equal(service.list({}, 50, 0).works[0]!.coverUrl, 'https://p3.example.com/cover-b.jpg');
});

test('短标题：太长截到 40 字加省略号；只有话题时用原文', () => {
  assert.equal(shortVideoTitle('一'.repeat(60)), `${'一'.repeat(39)}…`);
  assert.equal(shortVideoTitle('#只有话题'), '');
  assert.equal(shortVideoTitle('第一行标题\n第二行'), '第一行标题');
});
