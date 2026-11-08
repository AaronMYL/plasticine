import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { InboxMessageInput, MoneyEntryInput } from '../../shared/state.ts';
import { openState } from '../../src/state/index.ts';
import { device, forged, openTestState, START, steppingClock, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const at = (minutes: number): string => new Date(START + minutes * 60_000).toISOString();

function entry(overrides: Partial<MoneyEntryInput> = {}): MoneyEntryInput {
  return {
    kind: 'expense',
    amountCents: 2_850,
    currency: 'CNY',
    cnyCents: 2_850,
    categoryId: null,
    accountId: null,
    toAccountId: null,
    merchant: '面馆',
    note: null,
    occurredAt: at(0),
    discountCents: null,
    feeCents: null,
    confidence: null,
    review: false,
    origin: 'manual',
    ...overrides,
  };
}

function mail(overrides: Partial<InboxMessageInput> = {}): InboxMessageInput {
  return {
    source: 'email',
    fromAddress: 'friend@example.com',
    title: '周末见',
    body: '周六下午三点，老地方。',
    receivedAt: at(0),
    messageId: '<m1@example.com>',
    ...overrides,
  };
}

test('记账：金额只收正的整数分；删一笔只打时间，按时间段读不到它', () => {
  const { moneyEntries } = t.state;
  const kept = moneyEntries.create(entry());
  const removed = moneyEntries.create(entry({ occurredAt: at(10), amountCents: 100, cnyCents: 100 }));
  throwsState(() => moneyEntries.create(entry({ amountCents: 12.5 })), 'invalid_input');
  throwsState(() => moneyEntries.create(entry({ amountCents: 0 })), 'invalid_input');
  moneyEntries.update(removed.id, removed.version, { deletedAt: at(20) });
  assert.deepEqual(moneyEntries.between(at(-60), at(60)).map((row) => row.id), [kept.id]);
  assert.notEqual(moneyEntries.get(removed.id)?.deletedAt, null);
});

test('记账：转账引用的账户不存在时库拒绝', () => {
  throwsState(() => t.state.moneyEntries.create(entry({ kind: 'transfer', accountId: 'nope' })), 'invalid_input');
});

test('站内信：同一个 Message-ID 再收一次拿回原来那一条；十个分类和搜索按列筛', () => {
  const { inboxMessages } = t.state;
  const first = inboxMessages.add(mail());
  assert.equal(inboxMessages.add(mail({ title: '换了标题' })).created, false);
  const other = { messageId: null, body: '另一件事' };
  inboxMessages.add(mail({ ...other, source: 'feedback', title: '反馈：按钮太小', receivedAt: at(5) }));
  const patrol = inboxMessages.add(mail({ ...other, source: 'patrol', title: '巡查', receivedAt: at(6) }));
  inboxMessages.update(patrol.message.id, patrol.message.version, { archivedAt: at(7) });
  inboxMessages.update(first.message.id, first.message.version, { readAt: at(8), starredAt: at(8) });
  assert.equal(inboxMessages.count({ box: 'all' }), 2);
  assert.equal(inboxMessages.count({ box: 'unread' }), 1);
  assert.equal(inboxMessages.count({ box: 'starred' }), 1);
  assert.equal(inboxMessages.count({ box: 'archived' }), 1);
  assert.equal(inboxMessages.count({ box: 'feedback' }), 1);
  assert.deepEqual(inboxMessages.page({ box: 'all', query: '老地方' }, {}).map((row) => row.id), [first.message.id]);
  assert.equal(inboxMessages.unreadBySource().feedback, 1);
  assert.equal(inboxMessages.unreadBySource().email, 0);
});

test('站内信回复：同一个 action_id 只能记一次；收信进度一行，记两次是同一行', () => {
  const { message } = t.state.inboxMessages.add(mail());
  const base = { messageId: message.id, text: '好的', deviceId: null, sentAt: null, error: null };
  const reply = t.state.inboxReplies.create({ ...base, status: 'sending', actionId: 'inbox-reply:r1' });
  const twice = { ...base, status: 'stored' as const, actionId: 'inbox-reply:r1' };
  throwsState(() => t.state.inboxReplies.create(twice), 'duplicate');
  t.state.inboxReplies.update(reply.id, reply.version, { status: 'dry_run' });
  assert.equal(t.state.inboxReplies.byActionId('inbox-reply:r1')?.status, 'dry_run');
  t.state.inboxSync.record({ lastUid: 10, uidValidity: 7, lastCount: 3 });
  const second = t.state.inboxSync.record({ lastUid: 12, lastError: null });
  assert.equal(second.version, 2);
  assert.equal(t.state.inboxSync.get()?.uidValidity, 7);
});

test('工具组开关只经设备确认写；版本对不上就冲突，不覆盖', () => {
  const { toolGroups } = t.state;
  assert.equal(toolGroups.get('cloud_ssh'), undefined);
  throwsState(() => toolGroups.confirm('cloud_ssh', 0, true, forged({})), 'confirmation_required');
  const on = toolGroups.confirm('cloud_ssh', 0, true, device());
  assert.equal(on.enabled, true);
  assert.equal(on.confirmedByDeviceId, 'iphone-1');
  throwsState(() => toolGroups.confirm('cloud_ssh', 0, false, device()), 'version_conflict');
  assert.equal(toolGroups.confirm('cloud_ssh', 1, false, device()).version, 2);
  throwsState(() => toolGroups.confirm(forged('rm_rf'), 0, true, device()), 'invalid_input');
});
