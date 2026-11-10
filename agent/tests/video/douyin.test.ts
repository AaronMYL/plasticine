import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { DouyinListedWork } from '../../shared/api/video.ts';
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
