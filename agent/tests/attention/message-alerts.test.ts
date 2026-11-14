// 新消息通知（第13批，11-14 Aaron 定）：谁发的 + 消息开头，点开定位到那一句；正在看的那段不通知；同一个群 2 分钟内
// 的合成一条「n 条新消息」（同一个 tag，新的换掉旧的）。网页推送和桌面客户端（notify 事件）用同一份。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotifyEvent, PushPayload } from '../../shared/api/index.ts';
import { alertBrief, MessageAlerts } from '../../src/attention/message-alerts.ts';
import { Presence, PRESENCE_TTL_MS } from '../../src/attention/presence.ts';

function setup(start = Date.parse('2026-11-14T10:00:00Z')) {
  let now = start;
  const pushed: PushPayload[] = [];
  const published: NotifyEvent[] = [];
  const presence = new Presence();
  const alerts = new MessageAlerts({ presence, now: () => new Date(now),
    push: { announce: async (payload) => { pushed.push(payload); } },
    publish: (event) => published.push(event) });
  return { alerts, presence, pushed, published, advance: (ms: number) => { now += ms; }, at: () => new Date(now) };
}

test('联系人新消息：标题是谁发的，正文是消息开头，点开到那段聊天的那一句', () => {
  const t = setup();
  assert.equal(t.alerts.contact({ contactId: 'c1', name: '林一', messageId: 'm 1', text: '周末一起去看展吗？',
    sender: null, group: false }), true);
  assert.deepEqual(t.pushed, [{ title: '林一', body: '周末一起去看展吗？', url: '/#/messages/c1/at/m%201',
    tag: 'contact-c1' }]);
  assert.deepEqual(t.published, [{ type: 'notify', title: '林一', body: '周末一起去看展吗？',
    url: '/#/messages/c1/at/m%201', tag: 'contact-c1', conversation: 'contact:c1' }]);
});

test('群组：写「谁：开头」；2 分钟内又来就合成「n 条新消息」，隔久了重新算', () => {
  const t = setup();
  const say = (messageId: string, sender: string, text: string): boolean => t.alerts.contact({ contactId: 'g1',
    name: '读书会', messageId, text, sender, group: true });
  say('m1', '林一', '这周读到第六章');
  t.advance(30_000);
  say('m2', '周二', '我也是');
  t.advance(60_000);
  say('m3', '林一', '那周六聊');
  assert.deepEqual(t.pushed.map((payload) => [payload.title, payload.body, payload.tag]), [
    ['读书会', '林一：这周读到第六章', 'contact-g1'],
    ['读书会', '2 条新消息', 'contact-g1'],
    ['读书会', '3 条新消息', 'contact-g1'],
  ]);
  assert.equal(t.pushed[2]?.url, '/#/messages/g1/at/m3');
  t.advance(3 * 60_000);
  say('m4', '周二', '好');
  assert.equal(t.pushed.at(-1)?.body, '周二：好');
});

test('主线、队友的回复：标题是它的名字，点开到那条线的那一句；正在看的那段不通知', () => {
  const t = setup();
  t.presence.report('d-mac', 'line:line-main', t.at());
  assert.equal(t.alerts.line({ lineId: 'line-main', seq: 12, name: '卷毛', text: '查好了，**三家**都能投。' }), false);
  assert.equal(t.pushed.length, 0);
  assert.equal(t.alerts.line({ lineId: 'line-m1', seq: 4, name: '求职顾问', text: '简历第二版改好了' }), true);
  assert.deepEqual(t.pushed.at(-1), { title: '求职顾问', body: '简历第二版改好了',
    url: '/#/plasticine/line%3Aline-m1%3A4', tag: 'line-line-m1' });
  t.advance(PRESENCE_TTL_MS + 1);
  assert.equal(t.alerts.line({ lineId: 'line-main', seq: 13, name: '卷毛', text: '还有一件' }), true, '太久没报就当没在看');
  t.presence.report('d-mac', null, t.at());
  assert.equal(t.presence.viewing('line:line-main', t.at()), false);
});

test('消息开头：去掉 Markdown 记号、并成一行、太长截断', () => {
  assert.equal(alertBrief('# 标题\n\n看 [这篇](https://example.com) 的 **第二段**，`代码`'), '标题 看 这篇 的 第二段，代码');
  const long = '很'.repeat(80);
  assert.equal(alertBrief(long), `${'很'.repeat(59)}…`);
  assert.equal(alertBrief('   '), '');
});
