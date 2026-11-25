import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { NoticeInput } from '../../src/attention/index.ts';
import { DEFAULT_ITEMS, Heartbeat, inQuiet } from '../../src/heartbeat/index.ts';
import type { TextModels, TextRequest } from '../../src/kernel/index.ts';
import type { SuggestionInputDraft } from '../../src/tasks/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

interface World {
  heartbeat: Heartbeat;
  asked: TextRequest[];
  notices: NoticeInput[];
  opened: { title: string; goal: string }[];
  suggested: SuggestionInputDraft[];
  clock: { at: Date };
}

function world(answers: string[], options: { noModel?: boolean; caught?: string[];
  stuck?: { lineId: string; title: string; reason: string }[]; preferences?: string } = {}): World {
  const asked: TextRequest[] = [];
  const notices: NoticeInput[] = [];
  const opened: { title: string; goal: string }[] = [];
  const suggested: SuggestionInputDraft[] = [];
  const clock = { at: new Date('2026-11-07T14:30:00+08:00') };
  const models: TextModels = {
    async ask(request) {
      asked.push(request);
      return { text: answers.shift() ?? '{"note":"没事"}', complete: true };
    },
  };
  let id = 0;
  const heartbeat = new Heartbeat({ state: t.state, now: () => clock.at, zone: () => 'Asia/Shanghai',
    models: options.noModel === true ? null : models,
    notify: (input) => {
      notices.push(input);
      return true;
    },
    open: (input) => {
      opened.push(input);
      return `line-${opened.length}`;
    },
    suggest: (input) => {
      suggested.push(input);
      return { created: true };
    },
    newId: () => `item-${(id += 1)}`,
    ...(options.caught === undefined ? {} : { catchUp: () => options.caught?.splice(0) ?? [] }),
    ...(options.stuck === undefined ? {} : { stuck: () => options.stuck ?? [] }),
    ...(options.preferences === undefined ? {} : { preferences: () => options.preferences ?? '' }),
  });
  return { heartbeat, asked, notices, opened, suggested, clock };
}

function inviteMail(title: string): void {
  t.state.inboxMessages.add({ source: 'email', fromAddress: 'lin@example.test', fromName: '小林',
    title, body: '请确认', receivedAt: '2026-11-07T05:00:00.000Z', messageId: `<${title}@example.test>`,
    attachments: ['invite.ics'] });
}

test('quiet hours spanning midnight skip heartbeat ticks between 23:00 and 08:00', () => {
  assert.equal(inQuiet(new Date('2026-11-07T23:30:00+08:00'), 'Asia/Shanghai', '23:00', '08:00'), true);
  assert.equal(inQuiet(new Date('2026-11-08T07:59:00+08:00'), 'Asia/Shanghai', '23:00', '08:00'), true);
  assert.equal(inQuiet(new Date('2026-11-08T08:00:00+08:00'), 'Asia/Shanghai', '23:00', '08:00'), false);
});

test('skips model call when nothing changed, logs quiet entry in recent without posting to main', async () => {
  const w = world([]);
  await w.heartbeat.beat(w.clock.at);
  assert.equal(w.asked.length, 0);
  assert.equal(w.notices.length, 0);
  const view = w.heartbeat.view();
  assert.equal(view.recent[0]?.note, '没事');
  assert.equal(t.state.timedSlots.heartbeats.recent(5).length, 0, '没叫模型的那一跳不记');
  assert.deepEqual(view.config.items.map((item) => item.text), DEFAULT_ITEMS.map((item) => item.text));
});

test('new email invite calls heartbeat model to post, start draft line, suggest; skips next tick', async () => {
  inviteMail('评审会');
  const w = world([JSON.stringify({ tell: '「评审会」的邀请在等你回复，时间是周二下午。', brief: '有封邀请在等你回复',
    start: [{ title: '起草给小林的回复', goal: '起草接受评审会邀请的回复，不发出', refs: [] }],
    suggest: [{ title: '把周二下午空出来', why: '评审会在那时候', goal: '看周二下午的安排' }],
    note: '「评审会」邀请要回复' })]);
  await w.heartbeat.beat(w.clock.at);
  assert.equal(w.asked.length, 1);
  assert.equal(w.asked[0]?.purpose, 'heartbeat');
  assert.match(w.asked[0]?.messages[0]?.content ?? '', /会议邀请：小林《评审会》/);
  assert.equal(w.notices[0]?.text, '「评审会」的邀请在等你回复，时间是周二下午。');
  assert.equal(w.notices[0]?.brief, '有封邀请在等你回复');
  assert.equal(w.opened[0]?.title, '起草给小林的回复');
  assert.match(w.opened[0]?.goal ?? '', /心跳看到：会议邀请/);
  assert.equal(w.suggested[0]?.source, 'heartbeat');
  const beat = t.state.timedSlots.heartbeats.recent(1)[0];
  assert.match(beat?.note ?? '', /^「评审会」邀请要回复 → 发了消息给你/);
  assert.equal(w.heartbeat.row().last?.glyph, 'done');
  w.clock.at = new Date('2026-11-07T15:00:00+08:00');
  await w.heartbeat.beat(w.clock.at);
  assert.equal(w.asked.length, 1, '同一封邀请不再叫模型');
});

test('injects user\'s proactive-notice preferences (topics, timing, channel) before judging', async () => {
  inviteMail('评审会');
  const w = world([JSON.stringify({ note: '没事' })], { preferences: '### 别提的\n- 周末不提工作上的事' });
  await w.heartbeat.beat(w.clock.at);
  const material = JSON.parse(w.asked[0]?.messages[0]?.content ?? '{}') as { preferences: string };
  assert.equal(material.preferences, '### 别提的\n- 周末不提工作上的事');
  assert.match(w.asked[0]?.system ?? '', /「别提的」里的事不写进 tell、suggest/);
});

test('model failure logs reason and leaves items for re-evaluation on next tick', async () => {
  inviteMail('周会');
  const w = world(['不是 JSON', JSON.stringify({ note: '没事' })]);
  await w.heartbeat.beat(w.clock.at);
  assert.equal(w.heartbeat.row().last?.glyph, 'err');
  assert.equal(t.state.timedSlots.heartbeats.recent(1)[0]?.failed, true);
  await w.heartbeat.beat(new Date('2026-11-07T15:00:00+08:00'));
  assert.equal(w.asked.length, 2);
});

test('heartbeat ticks every 30m, defers overnight to 08:00, stops when disabled', async () => {
  const w = world([]);
  w.heartbeat.tick(w.clock.at);
  await w.heartbeat.settled();
  assert.equal(w.heartbeat.row().nextAt, new Date('2026-11-07T15:00:00+08:00').toISOString());
  w.clock.at = new Date('2026-11-07T23:10:00+08:00');
  w.heartbeat.tick(w.clock.at);
  assert.equal(w.heartbeat.row().nextAt, new Date('2026-11-08T08:00:00+08:00').toISOString());
  w.heartbeat.setEnabled(false);
  assert.equal(w.heartbeat.row().nextAt, null);
  assert.equal(w.heartbeat.row().canRemove, false);
});

test('checklist keeps reordered, deleted, and custom items; natural-language edit uses model', async () => {
  const w = world([JSON.stringify({ remove: ['feed'], add: ['快递到了没有'] })]);
  const items = w.heartbeat.config().items;
  const view = w.heartbeat.update({ items: [{ id: 'due', text: '今天到期的项目待办' },
    ...items.filter((item) => item.id !== 'due' && item.id !== 'calendar').map((item) => ({ id: item.id,
      text: item.text })), { text: '有没有人在群里提到我' }] });
  assert.equal(view.config.items[0]?.id, 'due');
  assert.equal(view.config.items.some((item) => item.id === 'calendar'), false);
  assert.equal(view.config.items.at(-1)?.kind, 'custom');
  const said = await w.heartbeat.say('别再看信息流了，看看快递', AbortSignal.timeout(1000));
  assert.equal(said.config.items.some((item) => item.id === 'feed'), false);
  assert.equal(said.config.items.at(-1)?.text, '快递到了没有');
});

test('heartbeat backfills missed schedule once, posts to main, logs tick; silent if none missed', async () => {
  const w = world([], { caught: ['日报', '宇宙与物理周报'] });
  await w.heartbeat.beat(w.clock.at);
  assert.equal(w.notices.length, 1);
  assert.equal(w.notices[0]?.text, '日报、宇宙与物理周报没按时出，已补一期。');
  const beats = t.state.timedSlots.heartbeats.recent(5);
  assert.equal(beats.some((beat) => beat.note === '日报、宇宙与物理周报没按时出，已补一期。'), true);
  await w.heartbeat.beat(new Date(w.clock.at.getTime() + 30 * 60_000));
  assert.equal(w.notices.length, 1);
});

test('failed background task checked even off-checklist; opens Follow-up line once without repeat', async () => {
  const stuck = [{ lineId: 'line-a', title: '抓三篇原文', reason: '第二个来源超时' }];
  const w = world([JSON.stringify({ start: [{ title: '换来源再抓三篇原文', refs: ['stuck:line-a'],
    goal: '原来那件 line:line-a 因为第二个来源超时没成；这次换成官网的存档页。' }], note: '有一件没做成' })], { stuck });
  w.heartbeat.update({ items: [] });
  await w.heartbeat.beat(w.clock.at);
  assert.equal(w.asked.length, 1);
  const material = JSON.parse(w.asked[0]?.messages.at(-1)?.content as string) as { fresh: { key: string; item: string;
    text: string }[] };
  assert.deepEqual(material.fresh, [{ key: 'stuck:line-a', item: '没做成的后台任务',
    text: '后台任务「抓三篇原文」没做成（line:line-a）：第二个来源超时' }]);
  assert.equal(w.opened.length, 1);
  assert.equal(w.opened[0]?.title, '跟进：换来源再抓三篇原文');
  assert.match(w.opened[0]?.goal ?? '', /line:line-a/);
  await w.heartbeat.beat(new Date(w.clock.at.getTime() + 30 * 60_000));
  assert.equal(w.asked.length, 1);
});
