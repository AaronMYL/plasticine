import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerEvent } from '../../shared/api/index.ts';
import type { LineMessageView } from '../../shared/api/lines.ts';
import { EventHub, type HubEvent } from '../../src/app/event-hub.ts';

const started = (noteId: string): ServerEvent => ({ type: 'note_invalidated', noteId });

function answer(lineId: string): LineMessageView {
  return { lineId, seq: 2, role: 'assistant', origin: null, text: '', thinking: null, thinkingMs: null, steps: [],
    toolCallId: null,
    tool: null, say: null, ok: null, summary: null, stopReason: 'stop', childLineId: null, attachments: [], widgets: [],
    createdAt: '2026-11-05T00:00:00.000Z' };
}

const OWNER = { sessionId: 'session-1', deviceId: 'device-1' };

test('line stream buffers split links until complete verbatim; reconnect replay matches final text', () => {
  const hub = new EventHub(100, 'text');
  const seen: HubEvent[] = [];
  hub.subscribe(OWNER, null, (event) => seen.push(event), () => undefined);
  const parts = ['看 ht', 'tps:/', '/reader:example@demo.test/a?access', 'Token=example&x=1#part', '。末尾'];
  for (const delta of parts) {
    hub.publish({ type: 'line_text', lineId: 'line-main', delta });
  }
  hub.publish({ type: 'line_message', message: answer('line-main') });
  const textOf = (entries: HubEvent[]) => entries.map(({ event }) =>
    event.type === 'line_text' ? event.delta : '').join('');
  assert.equal(textOf(seen), parts.join(''));
  assert.ok(seen.some(({ event }) => event.type === 'line_text'
    && event.delta.includes('https://reader:example@demo.test/a?accessToken=example&x=1#part')));
  const replay = hub.subscribe(OWNER, seen[1]?.id ?? null, () => undefined, () => undefined).replay;
  assert.equal(textOf([...seen.slice(0, 2), ...replay]), textOf(seen));
});

test('concurrent streaming on two lines buffers each tail separately without cross-talk', () => {
  const hub = new EventHub();
  const seen: HubEvent[] = [];
  hub.subscribe(OWNER, null, (event) => seen.push(event), () => undefined);
  hub.publish({ type: 'line_text', lineId: 'a', delta: '甲说 https://a.test/?token=' });
  hub.publish({ type: 'line_text', lineId: 'b', delta: '乙说完了。' });
  hub.publish({ type: 'line_changed', line: { id: 'b', kind: 'background', parentLineId: null, parentMessageSeq: null,
    projectId: null,
    title: 'b', status: 'idle', pauseReason: null, outcome: null, pausedUntil: null, failure: null, activity: null,
    activeSince: null, queued: 0,
    lastAnswer: null, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' } });
  const of = (lineId: string) => seen.filter(({ event }) => event.type === 'line_text' && event.lineId === lineId)
    .map(({ event }) => (event.type === 'line_text' ? event.delta : '')).join('');
  assert.equal(of('b'), '乙说完了。');
  assert.equal(of('a'), '甲说 ');
  hub.publish({ type: 'line_message', message: answer('a') });
  assert.equal(of('a'), '甲说 https://a.test/?token=');
});

test('event IDs carry batch and sequence; subscribers receive events in publish order', () => {
  const hub = new EventHub(10, 'epoch1');
  const seen: HubEvent[] = [];
  hub.subscribe(OWNER, null, (event) => seen.push(event), () => undefined);
  hub.publish(started('r1'));
  hub.publish(started('r2'));
  assert.deepEqual(
    seen.map((event) => event.id),
    ['epoch1-1', 'epoch1-2'],
  );
});

test('subscribing with Last-Event-ID replays subsequent missed events', () => {
  const hub = new EventHub(10, 'epoch1');
  hub.publish(started('r1'));
  hub.publish(started('r2'));
  hub.publish(started('r3'));
  const subscription = hub.subscribe(OWNER, 'epoch1-1', () => undefined, () => undefined);
  assert.equal(subscription.resync, false);
  assert.deepEqual(
    subscription.replay.map((event) => event.id),
    ['epoch1-2', 'epoch1-3'],
  );
});

test('evicted or foreign-batch Last-Event-ID requests full resync', () => {
  const hub = new EventHub(2, 'epoch1');
  for (const runId of ['r1', 'r2', 'r3', 'r4']) {
    hub.publish(started(runId));
  }
  assert.equal(hub.subscribe(OWNER, 'epoch1-1', () => undefined, () => undefined).resync, true);
  assert.equal(hub.subscribe(OWNER, 'epoch1-2', () => undefined, () => undefined).resync, false);
  assert.equal(hub.subscribe(OWNER, 'other-3', () => undefined, () => undefined).resync, true);
  assert.equal(hub.subscribe(OWNER, 'epoch1-99', () => undefined, () => undefined).resync, true);
  assert.equal(hub.subscribe(OWNER, '乱写的', () => undefined, () => undefined).resync, true);
});

test('error in one subscriber closes only that subscriber while others continue receiving', () => {
  const hub = new EventHub(10, 'epoch1');
  let closed = false;
  const seen: string[] = [];
  hub.subscribe(
    OWNER,
    null,
    () => {
      throw new Error('连接断了');
    },
    () => {
      closed = true;
    },
  );
  hub.subscribe(OWNER, null, (event) => seen.push(event.id), () => undefined);
  hub.publish(started('r1'));
  assert.equal(closed, true);
  assert.deepEqual(seen, ['epoch1-1']);
  assert.equal(hub.subscriberCount, 1);
});

test('closeAll terminates all active subscriptions', () => {
  const hub = new EventHub(10, 'epoch1');
  let closes = 0;
  hub.subscribe(OWNER, null, () => undefined, () => {
    closes += 1;
  });
  hub.subscribe(OWNER, null, () => undefined, () => {
    closes += 1;
  });
  hub.closeAll();
  assert.equal(closes, 2);
  assert.equal(hub.subscriberCount, 0);
});

test('logout closes only that session\'s stream; device revoke closes all its streams; others continue', () => {
  const hub = new EventHub(10, 'epoch1');
  const closed: string[] = [];
  const open = (name: string, owner: { sessionId: string; deviceId: string }) => {
    hub.subscribe(owner, null, () => undefined, () => closed.push(name));
  };
  open('手机', { sessionId: 's-phone', deviceId: 'd-phone' });
  open('手机第二个标签页', { sessionId: 's-phone-2', deviceId: 'd-phone' });
  open('电脑', { sessionId: 's-laptop', deviceId: 'd-laptop' });
  hub.closeSession('s-phone');
  assert.deepEqual(closed, ['手机']);
  hub.closeDevice('d-phone');
  assert.deepEqual(closed, ['手机', '手机第二个标签页']);
  assert.equal(hub.subscriberCount, 1);
});
