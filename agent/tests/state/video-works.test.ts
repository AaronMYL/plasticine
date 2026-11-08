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

test('按作品 ID 去重：再同步一次只补收藏夹和配文，不动走到哪', () => {
  const first = listed('7300000000000000001', '普通人做指数定投的三个误区', ['f1']);
  assert.equal(first.created, true);
  t.state.videoWorks.want([first.work.id]);
  const again = listed('7300000000000000001', '普通人做指数定投的三个误区', ['f2']);
  assert.equal(again.created, false);
  assert.equal(again.work.id, first.work.id);
  assert.deepEqual(again.work.folderIds, ['f1', 'f2']);
  assert.equal(again.work.run, 'queued');
});

test('勾选处理：总结过的、在排的不重复排', () => {
  const a = listed('7300000000000000001', 'A').work;
  const b = listed('7300000000000000002', 'B').work;
  t.state.videoWorks.advance(b.id, { stage: 'summarized' });
  assert.deepEqual(t.state.videoWorks.want([a.id, b.id]), [a.id]);
  assert.deepEqual(t.state.videoWorks.want([a.id]), []);
  t.state.videoWorks.advance(a.id, { run: 'failed', error: '下载失败' });
  assert.deepEqual(t.state.videoWorks.want([a.id]), [a.id]);
  assert.equal(t.state.videoWorks.require(a.id).attempts, 1);
});

test('状态只往前走：已总结的不能退回已预览', () => {
  const a = listed('7300000000000000001', 'A').work;
  t.state.videoWorks.advance(a.id, { stage: 'previewed', preview: { summary: 's', outline: [], points: ['p'],
    related: [], enough: false } });
  t.state.videoWorks.advance(a.id, { stage: 'summarized' });
  throwsState(() => t.state.videoWorks.advance(a.id, { stage: 'previewed' }), 'invalid_input');
  assert.equal(t.state.videoWorks.require(a.id).preview?.points[0], 'p');
});

test('列表按收藏时间新的在前，可按收藏夹和标题、作者搜', () => {
  listed('7300000000000000001', '家常红烧肉', ['cook'], '2026-10-28T08:00:00.000Z');
  listed('7300000000000000002', '独立开发者怎么定价', [], '2026-10-30T08:00:00.000Z');
  const all = t.state.videoWorks.page({ platform: 'douyin' }, 10, 0);
  assert.deepEqual(all.works.map((work) => work.title), ['独立开发者怎么定价', '家常红烧肉']);
  assert.equal(t.state.videoWorks.page({ platform: 'douyin', folder: 'cook' }, 10, 0).total, 1);
  assert.equal(t.state.videoWorks.page({ platform: 'douyin', q: '定价' }, 10, 0).works[0]?.title, '独立开发者怎么定价');
  assert.equal(t.state.videoWorks.page({ platform: 'douyin', q: '100%' }, 10, 0).total, 0);
  assert.deepEqual(t.state.videoWorks.newestWorkIds('douyin', 1), ['7300000000000000002']);
});

test('Mac 的活：同一件不重复排；取走没交回的过时再给；交回后算了结', () => {
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
