// 通知统一成「主线发一条消息 + 系统通知」（《优化清单》第 12 条）：同一件按 key 只发一次（重启、再扫一遍都不重发）；
// 系统通知只带一句话和站内链接，不带消息正文（第 91 条）；推送失败不影响主线上那一条。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PushPayload } from '../../shared/api/push.ts';
import { Notices, type NoticeInput } from '../../src/attention/notices.ts';
import { openState, type StateService } from '../../src/state/index.ts';

let t: { state: StateService; directory: string };
let posted: NoticeInput[];
let pushed: PushPayload[];

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'plasticine-notices-'));
  t = { state: openState({ path: join(directory, 'plasticine.sqlite'), now: () => '2026-11-07T04:00:00.000Z' }),
    directory };
  posted = [];
  pushed = [];
});

afterEach(async () => {
  t.state.close();
  await rm(t.directory, { recursive: true, force: true });
});

function notices(push: (payload: PushPayload) => Promise<void> = async (payload) => {
  pushed.push(payload);
}): Notices {
  return new Notices({ state: t.state, post: (input) => posted.push(input), push: { announce: push },
    now: () => new Date('2026-11-07T04:00:00.000Z') });
}

const OVERDUE: NoticeInput = { key: 'project-overdue:p1:2026-10-30', text: '项目「资料交接」过了截止日还没完成。',
  brief: '有项目过了截止', url: '/#/projects/p1' };

test('发一件：主线一条消息，系统通知只有一句话和站内链接', async () => {
  const n = notices();
  assert.equal(n.post(OVERDUE), true);
  await n.settled();
  assert.deepEqual(posted, [OVERDUE]);
  assert.deepEqual(pushed, [{ title: 'Plasticine', body: '有项目过了截止', url: '/#/projects/p1',
    tag: 'project-overdue:p1:2026-10-30' }]);
  assert.doesNotMatch(JSON.stringify(pushed), /资料交接/);
});

test('同一件只发一次：再扫一遍、换个实例（重启）都不再发', async () => {
  assert.equal(notices().post(OVERDUE), true);
  assert.equal(notices().post(OVERDUE), false);
  assert.equal(posted.length, 1);
});

test('以前寄过通知信的同一件（同一个动作标识）不再在主线上补发', () => {
  t.state.receipts.issue({ actionId: OVERDUE.key, tool: 'notification_mail', argsDigest: 'x', replay: 'once',
    effect: 'external' });
  assert.equal(notices().post(OVERDUE), false);
  assert.equal(posted.length, 0);
});

test('推送失败：主线上那条照样在，回执不回滚', async () => {
  const n = notices(async () => {
    throw new Error('push service down');
  });
  assert.equal(n.post(OVERDUE), true);
  await n.settled();
  assert.equal(posted.length, 1);
  assert.equal(notices().post(OVERDUE), false);
});

test('主线没写成：回执回滚，下一次扫描还会再发', () => {
  const failing = new Notices({ state: t.state, post: () => {
    throw new Error('主线写库失败');
  }, push: { announce: async () => undefined }, now: () => new Date() });
  assert.throws(() => failing.post(OVERDUE), /主线写库失败/);
  assert.equal(notices().post(OVERDUE), true);
});

test('只推不发消息的（后台线没做完：结果已经贴在主线上）：系统通知一句话', async () => {
  const n = notices();
  n.announce({ body: '后台的一件事没做完', url: '/#/conversation', tag: 'line-report:l1:1' });
  await n.settled();
  assert.deepEqual(pushed, [{ title: 'Plasticine', body: '后台的一件事没做完', url: '/#/conversation',
    tag: 'line-report:l1:1' }]);
  assert.equal(posted.length, 0);
});
