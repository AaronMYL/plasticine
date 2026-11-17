// 心跳每一跳从库里读的「来信、会议邀请、信息流命中关注点」（11-17 起直接读站内信和信息流的表，不再经触发表）。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openTestState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const SINCE = '2026-11-15T00:00:00.000Z';

function mail(input: { title: string; from?: string; at?: string; attachments?: string[];
  source?: 'email' | 'plasticine' }) {
  return t.state.inboxMessages.add({ source: input.source ?? 'email', fromAddress: input.from ?? 'lin@example.test',
    fromName: '小林', title: input.title, body: '正文', receivedAt: input.at ?? '2026-11-16T02:00:00.000Z',
    messageId: `<${input.title}@example.test>`, attachments: input.attachments ?? [] }).message;
}

function replied(messageId: string, status: 'sent' | 'failed'): void {
  const reply = t.state.inboxReplies.create({ messageId, text: '好的', actionId: `act-${messageId}`,
    deviceId: 'device-1', status: 'sending', sentAt: null, error: null });
  t.state.inboxReplies.update(reply.id, reply.version, status === 'sent'
    ? { status: 'sent', sentAt: '2026-11-10T03:00:00.000Z' } : { status: 'failed', error: '没发出去' });
}

test('来信只算两种：带日历附件的会议邀请、他回过信的人；陌生人的普通信不算', () => {
  const invite = mail({ title: '评审会', from: 'stranger@example.test', attachments: ['Invite.ICS'] });
  mail({ title: '促销', from: 'shop@example.test' });
  const earlier = mail({ title: '上周的事', from: 'lin@example.test', at: '2026-11-09T02:00:00.000Z' });
  replied(earlier.id, 'sent');
  const known = mail({ title: '周会改期', from: 'lin@example.test', at: '2026-11-16T03:00:00.000Z' });
  // 回信没发出去的不算认识。
  const failed = mail({ title: '问过一次', from: 'chen@example.test', at: '2026-11-09T02:00:00.000Z' });
  replied(failed.id, 'failed');
  mail({ title: '又来一封', from: 'chen@example.test' });

  assert.deepEqual(t.state.heartbeatFacts.mail(SINCE), [
    { id: known.id, kind: 'known_sender', from: '小林', title: '周会改期', receivedAt: '2026-11-16T03:00:00.000Z' },
    { id: invite.id, kind: 'invite', from: '小林', title: '评审会', receivedAt: '2026-11-16T02:00:00.000Z' },
  ]);
});

test('读过、处理过、归档了、太早的来信不算；Plasticine 自己的通知信不算', () => {
  const read = mail({ title: '读过的', attachments: ['a.ics'] });
  const handled = mail({ title: '处理过的', attachments: ['a.ics'] });
  const archived = mail({ title: '归档的', attachments: ['a.ics'] });
  mail({ title: '太早的', attachments: ['a.ics'], at: '2026-11-14T02:00:00.000Z' });
  mail({ title: 'Plasticine · 今天的事', attachments: ['a.ics'], source: 'plasticine' });
  const fresh = mail({ title: '新的', attachments: ['a.vcs'] });
  t.state.inboxMessages.update(read.id, read.version, { readAt: '2026-11-16T04:00:00.000Z' });
  t.state.inboxMessages.update(handled.id, handled.version, { handledAt: '2026-11-16T04:00:00.000Z' });
  t.state.inboxMessages.update(archived.id, archived.version, { archivedAt: '2026-11-16T04:00:00.000Z' });

  assert.deepEqual(t.state.heartbeatFacts.mail(SINCE).map((row) => row.id), [fresh.id]);
});

test('信息流只算挂着关注点的新条目；他点了不喜欢的、太早到的不算', () => {
  const source = t.state.feedSources.create({ kind: 'interest', label: '宏观投资' });
  const item = (title: string, concernId: string | null, arrivedAt: string) => t.state.feedItems.add({
    sourceId: source.id, origin: 'feed', title, url: `https://example.com/${encodeURIComponent(title)}`,
    summary: '', why: '', topic: source.label, concernId, dedupeKey: title, day: arrivedAt.slice(0, 10),
    arrivedAt }).item;
  const hit = item('命中的', 'interest:1', '2026-11-16T02:00:00.000Z');
  item('没挂关注点的', null, '2026-11-16T02:00:00.000Z');
  item('太早的', 'interest:1', '2026-11-14T02:00:00.000Z');
  const disliked = item('不喜欢的', 'interest:1', '2026-11-16T03:00:00.000Z');
  t.state.feedItems.update(disliked.id, disliked.version, { reaction: 'dislike' });

  assert.deepEqual(t.state.heartbeatFacts.feed(SINCE),
    [{ id: hit.id, title: '命中的', at: '2026-11-16T02:00:00.000Z' }]);
});
