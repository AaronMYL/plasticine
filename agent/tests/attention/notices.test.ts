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

test('announce posts one message to main line and sends one-line system push with in-app link', async () => {
  const n = notices();
  assert.equal(n.post(OVERDUE), true);
  await n.settled();
  assert.deepEqual(posted, [OVERDUE]);
  assert.deepEqual(pushed, [{ title: 'Plasticine', body: '有项目过了截止', url: '/#/projects/p1',
    tag: 'project-overdue:p1:2026-10-30' }]);
  assert.doesNotMatch(JSON.stringify(pushed), /资料交接/);
});

test('same announcement fires once across rescans and restarts', async () => {
  assert.equal(notices().post(OVERDUE), true);
  assert.equal(notices().post(OVERDUE), false);
  assert.equal(posted.length, 1);
});

test('actionId previously sent via email notice does not re-post to main line', () => {
  t.state.receipts.issue({ actionId: OVERDUE.key, tool: 'notification_mail', argsDigest: 'x', replay: 'once',
    effect: 'external' });
  assert.equal(notices().post(OVERDUE), false);
  assert.equal(posted.length, 0);
});

test('push failure leaves main-line message intact without rolling back receipt', async () => {
  const n = notices(async () => {
    throw new Error('push service down');
  });
  assert.equal(n.post(OVERDUE), true);
  await n.settled();
  assert.equal(posted.length, 1);
  assert.equal(notices().post(OVERDUE), false);
});

test('main-line write failure rolls back receipt so next scan retries', () => {
  const failing = new Notices({ state: t.state, post: () => {
    throw new Error('主线写库失败');
  }, push: { announce: async () => undefined }, now: () => new Date() });
  assert.throws(() => failing.post(OVERDUE), /主线写库失败/);
  assert.equal(notices().post(OVERDUE), true);
});

test('push-only notice (incomplete background work already on main line) sends one-line push', async () => {
  const n = notices();
  n.announce({ body: '后台的一件事没做完', url: '/#/conversation', tag: 'line-report:l1:1' });
  await n.settled();
  assert.deepEqual(pushed, [{ title: 'Plasticine', body: '后台的一件事没做完', url: '/#/conversation',
    tag: 'line-report:l1:1' }]);
  assert.equal(posted.length, 0);
});
