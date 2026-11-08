import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { ContactMessageInput } from '../../shared/state.ts';
import { StateError } from '../../src/state/index.ts';
import { openTestState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function contact(accountId = 'acct-bob-0001') {
  return t.state.contacts.create({ accountId, handle: 'bob', displayName: 'Bob', signingKey: 'sig-bob',
    encryptionKey: 'enc-bob', state: 'active', lastAt: '2026-11-03T10:00:00.000Z' });
}

function message(contactId: string, overrides: Partial<ContactMessageInput> = {}) {
  return t.state.contactMessages.create({ contactId, direction: 'in', author: 'them', kind: 'text', text: '你好',
    payload: { text: '你好', replyTo: null }, sentAt: '2026-11-03T10:00:00.000Z', status: 'sent', ...overrides });
}

test('网络账号只有一行；游标、同步时间和错误按 version 改', () => {
  assert.equal(t.state.networkIdentity.get(), undefined);
  const identity = t.state.networkIdentity.create({ accountId: 'acct-me-0001', handle: 'alex', displayName: 'Alex',
    relayUrl: 'http://127.0.0.1:8790', signingPublicKey: 'sp', signingPrivateKey: 'sk', encryptionPublicKey: 'ep',
    encryptionPrivateKey: 'ek', joinedAt: '2026-11-03T10:00:00.000Z' });
  assert.equal(identity.cursor, '0');
  assert.throws(() => t.state.networkIdentity.create({ ...identity, cursor: '0' }), StateError);
  const synced = t.state.networkIdentity.update(identity.version, { cursor: '12', lastError: null,
    lastSyncAt: '2026-11-03T10:01:00.000Z' });
  assert.equal(synced.cursor, '12');
  assert.throws(() => t.state.networkIdentity.update(identity.version, { cursor: '13' }), StateError);
});

test('联系人按账号 id 唯一；关系默认陌生人；改要带 version', () => {
  const bob = contact();
  assert.equal(bob.relation, 'stranger');
  assert.equal(bob.safetyChanged, false);
  assert.equal(t.state.contacts.byAccount('acct-bob-0001')?.id, bob.id);
  assert.throws(() => contact(), StateError);
  const friend = t.state.contacts.update(bob.id, bob.version, { relation: 'friend', tierCap: 'partner' });
  assert.equal(friend.tierCap, 'partner');
  assert.throws(() => t.state.contacts.update(bob.id, bob.version, { relation: 'partner' }), StateError);
});

test('同一封信（envelope_id）、同一个界面请求（request_id）都只记一行', () => {
  const bob = contact();
  message(bob.id, { envelopeId: 'env-1' });
  assert.throws(() => message(bob.id, { envelopeId: 'env-1' }), StateError);
  const out = message(bob.id, { direction: 'out', author: 'me', status: 'sending', requestId: 'req-00000001',
    envelopeId: 'env-2' });
  assert.equal(t.state.contactMessages.byRequest('req-00000001')?.id, out.id);
  assert.equal(t.state.contactMessages.byEnvelope('env-1')?.direction, 'in');
});

test('发件箱：只取到了时候的 sending；未读只算进来的，标已读到某一时刻为止', () => {
  const bob = contact();
  message(bob.id, { sentAt: '2026-11-03T10:00:00.000Z' });
  message(bob.id, { sentAt: '2026-11-03T10:05:00.000Z' });
  message(bob.id, { kind: 'read', text: '', sentAt: '2026-11-03T10:06:00.000Z' });
  const due = message(bob.id, { direction: 'out', author: 'me', status: 'sending', envelopeId: 'e-due' });
  const later = message(bob.id, { direction: 'out', author: 'me', status: 'sending', envelopeId: 'e-later' });
  t.state.contactMessages.update(later.id, later.version, { nextAttemptAt: '2026-11-03T11:00:00.000Z',
    attempts: 1 });
  assert.deepEqual(t.state.contactMessages.outboxDue('2026-11-03T10:30:00.000Z', 10).map((row) => row.id), [due.id]);
  assert.equal(t.state.contactMessages.unreadCount(bob.id), 2);
  assert.equal(t.state.contactMessages.markRead(bob.id, '2026-11-03T10:01:00.000Z', '2026-11-03T10:30:00.000Z'), 1);
  assert.equal(t.state.contactMessages.unreadCount(bob.id), 1);
  assert.equal(t.state.contactMessages.latest(bob.id)?.kind, 'text');
  assert.equal(t.state.contactMessages.page(bob.id, undefined, 50).length, 4);
});

test('档位：没有行 = 私密，建议不算确认；version 0 表示新建，对不上就冲突', () => {
  const marks = t.state.visibilityMarks;
  assert.equal(marks.get('project', 'p1'), undefined);
  const proposed = marks.put('project', 'p1', 0, { proposed: 'partner', confirmed: false });
  assert.equal(proposed.tier, 'private');
  assert.equal(proposed.confirmedAt, null);
  assert.throws(() => marks.put('project', 'p1', 0, { tier: 'public', proposed: null, confirmed: true }), StateError);
  const confirmed = marks.put('project', 'p1', proposed.version, { tier: 'partner', proposed: null, confirmed: true });
  assert.equal(confirmed.tier, 'partner');
  assert.notEqual(confirmed.confirmedAt, null);
  assert.equal(marks.all().length, 1);
});

test('跨用户任务用两端共用的 taskId；分身说过的话只追加，最近的在前', () => {
  const bob = contact();
  const task = t.state.networkTasks.create('task-shared-1', { direction: 'in', contactId: bob.id, title: '整理资料',
    goal: '把三篇文章整理成一页', acceptance: '一页纸，三段', state: 'offered', offeredAt: '2026-11-03T10:00:00.000Z' });
  assert.equal(task.id, 'task-shared-1');
  assert.equal(task.doer, null);
  const taken = t.state.networkTasks.update(task.id, task.version, { state: 'accepted', doer: 'ai',
    localTaskId: 'local-1' });
  assert.equal(t.state.networkTasks.byLocalTask('local-1')?.id, task.id);
  assert.deepEqual(t.state.networkTasks.awaitingLocal().map((row) => row.id), [taken.id]);
  t.state.saidLog.add({ contactId: bob.id, text: '第一句', materials: [], exchangeId: null, messageId: null });
  t.state.saidLog.add({ contactId: bob.id, text: '第二句', exchangeId: 'x1', messageId: null,
    materials: [{ kind: 'project', id: 'p1', tier: 'partner' }] });
  assert.deepEqual(t.state.saidLog.recent(bob.id, 20).map((entry) => entry.text), ['第二句', '第一句']);
});
