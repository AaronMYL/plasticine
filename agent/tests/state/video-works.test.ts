import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

function listed(workId: string, title: string, folderIds: string[] = [], collectedAt = '2026-11-06T08:00:00.000Z') {
  return t.state.videoWorks.upsert({ platform: 'douyin', workId, url: `https://www.douyin.com/video/${workId}`,
    title, author: '理财小课堂', collectedAt, folderIds });
}

test('Deduplicates works by ID; re-sync updates folders/caption without resetting stage', () => {
  const first = listed('7300000000000000001', '普通人做指数定投的三个误区', ['f1']);
  assert.equal(first.created, true);
  t.state.videoWorks.want([first.work.id]);
  const again = listed('7300000000000000001', '普通人做指数定投的三个误区', ['f2']);
  assert.equal(again.created, false);
  assert.equal(again.work.id, first.work.id);
  assert.deepEqual(again.work.folderIds, ['f1', 'f2']);
  assert.equal(again.work.run, 'queued');
});

test('Selecting items for processing skips already-summarized and queued works', () => {
  const a = listed('7300000000000000001', 'A').work;
  const b = listed('7300000000000000002', 'B').work;
  t.state.videoWorks.advance(b.id, { stage: 'summarized' });
  assert.deepEqual(t.state.videoWorks.want([a.id, b.id]), [a.id]);
  assert.deepEqual(t.state.videoWorks.want([a.id]), []);
  t.state.videoWorks.advance(a.id, { run: 'failed', error: '下载失败' });
  assert.deepEqual(t.state.videoWorks.want([a.id]), [a.id]);
  assert.equal(t.state.videoWorks.require(a.id).attempts, 1);
});

test('Work stage advances monotonically; summarized cannot regress to previewed', () => {
  const a = listed('7300000000000000001', 'A').work;
  t.state.videoWorks.advance(a.id, { stage: 'previewed', preview: { summary: 's', outline: [], points: ['p'],
    related: [], enough: false } });
  t.state.videoWorks.advance(a.id, { stage: 'summarized' });
  throwsState(() => t.state.videoWorks.advance(a.id, { stage: 'previewed' }), 'invalid_input');
  assert.equal(t.state.videoWorks.require(a.id).preview?.points[0], 'p');
});

test('Legacy works without order keep insert order; searchable by folder/title/author', () => {
  listed('7300000000000000001', '家常红烧肉', ['cook'], '2026-10-28T08:00:00.000Z');
  listed('7300000000000000002', '独立开发者怎么定价', [], '2026-10-30T08:00:00.000Z');
  const all = t.state.videoWorks.page({ platform: 'douyin' }, 10, 0);
  assert.deepEqual(all.works.map((work) => work.title), ['独立开发者怎么定价', '家常红烧肉']);
  assert.equal(t.state.videoWorks.page({ platform: 'douyin', folder: 'cook' }, 10, 0).total, 1);
  assert.equal(t.state.videoWorks.page({ platform: 'douyin', q: '定价' }, 10, 0).works[0]?.title, '独立开发者怎么定价');
  assert.equal(t.state.videoWorks.page({ platform: 'douyin', q: '100%' }, 10, 0).total, 0);
  assert.deepEqual(t.state.videoWorks.newestWorkIds('douyin', 1), ['7300000000000000002']);
});

test('Mac jobs deduplicate, lease-expire unreturned work, and complete on submission', () => {
  const job = t.state.videoMacJobs.queue('resolve', '7300000000000000001');
  assert.equal(t.state.videoMacJobs.queue('resolve', '7300000000000000001').id, job.id);
  const list = t.state.videoMacJobs.queue('list', null);
  const taken = t.state.videoMacJobs.take('2000-01-01T00:00:00.000Z', 10);
  assert.deepEqual(taken.map((row) => row.id).sort(), [job.id, list.id].sort());
  assert.equal(t.state.videoMacJobs.take('2000-01-01T00:00:00.000Z', 10).length, 0);
  assert.equal(t.state.videoMacJobs.take('2999-01-01T00:00:00.000Z', 10).length, 2);
  t.state.videoMacJobs.finish(list.id, null);
  assert.notEqual(t.state.videoMacJobs.lastList().lastDoneAt, null);
  assert.equal(t.state.videoMacJobs.lastList().open, null);
});

test('Favorite order precedes date; first synced item highest and newer before older', () => {
  const old = listed('7300000000000000001', '旧作品', [], '2026-11-09T00:00:00.000Z').work;
  for (const [index, title] of ['新收藏甲', '新收藏乙'].entries()) {
    t.state.videoWorks.upsert({ platform: 'douyin', workId: `730000000000000000${index + 2}`,
      url: 'https://www.douyin.com/video/7300000000000000002', title,
      collectedAt: index === 0 ? null : '2020-01-01T00:00:00.000Z', collectSeq: 100 - index });
  }
  const page = t.state.videoWorks.page({ platform: 'douyin' }, 10, 0);
  assert.deepEqual(page.works.map((work) => work.title), ['新收藏甲', '新收藏乙', '旧作品']);
  assert.equal(page.works[2]?.id, old.id);
  assert.deepEqual(t.state.videoWorks.newestWorkIds('douyin', 2), ['7300000000000000002', '7300000000000000003']);
});
