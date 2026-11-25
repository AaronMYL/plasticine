import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { scriptByLine, startKernel, type Harness } from './helpers.ts';

const open: Harness[] = [];

async function harness(): Promise<Harness> {
  const started = await startKernel();
  open.push(started);
  return started;
}

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

const MAIN = '这是主对话';
const HANDOFF = '已提交 3f9c2ab，改了 /home/plasticine/releases/current/x.ts；主线后续应提醒他重启。';

test('Subagent delivers conclusion only to main; hashes/paths stay in background line', async () => {
  const h = await harness();
  let reported = '';
  scriptByLine(h, {
    [MAIN]: [
      fauxAssistantMessage([fauxToolCall('start_line', { title: '修中继', goal: '把中继修好' }, { id: 's' })],
        { stopReason: 'toolUse' }),
      fauxAssistantMessage('开了一条线去修。'),
      (context: TranscriptContext) => {
        reported = JSON.stringify(context.messages);
        return fauxAssistantMessage('好');
      },
    ],
    修中继: [
      fauxAssistantMessage([fauxToolCall('line_outcome', { done: true,
        conclusion: '中继修好了：断线后会自己重连，测了三次都正常。' }, { id: 'o' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage(HANDOFF),
    ],
  });
  h.kernel.send('main', { text: '中继老断，修一下' });
  await h.kernel.settled();
  const report = h.kernel.read('main', 50).messages.find((message) => message.role === 'lineReport');
  assert.equal(report?.text, '中继修好了：断线后会自己重连，测了三次都正常。');
  h.kernel.send('main', { text: '好了吗' });
  await h.kernel.settled();
  assert.ok(reported.includes('中继修好了'));
  assert.ok(!reported.includes('3f9c2ab'), '技术交接不进主线上下文');
  const child = h.kernel.list({ kind: 'background', limit: 5 })[0];
  assert.equal(h.kernel.answer(child?.id ?? ''), HANDOFF, '交接原文还在后台线里');
});

test('Opening side chat carries feed item; sidebar lists main with status and side chat', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage('先说判断：你大概率符合。')]);
  h.kernel.send('main', { text: '数字游民签证我能不能申请' });
  await h.kernel.settled();
  const side = h.kernel.openSide({ title: '讨论：睡眠中的记忆重放', topic: { kind: 'feed', ref: 'feed_1',
    title: '睡眠中的记忆重放', source: 'bioRxiv', at: null, excerpt: '颅内电极记录 18 名受试者' } });
  let system = '';
  h.respond([(context) => {
    system = JSON.stringify(context.messages[0]);
    return fauxAssistantMessage('不算小。');
  }]);
  h.kernel.send(side.id, { text: '18 个人的样本够吗？' });
  await h.kernel.settled();
  assert.ok(system.includes('这是一条独立对话'));
  assert.ok(system.includes('颅内电极记录 18 名受试者'));
  assert.equal(h.kernel.view(side.id).topic?.source, 'bioRxiv');
  const chats = h.kernel.chats();
  assert.equal(chats.main.line.id, MAIN_LINE_ID);
  assert.equal(chats.main.status, '先说判断：你大概率符合。');
  assert.deepEqual(chats.sides.map((line) => line.title), ['讨论：睡眠中的记忆重放']);
});

test('Blank side chat derives its title from the first message sent', async () => {
  const h = await harness();
  const side = h.kernel.openSide({ title: '新旁聊', topic: null });
  h.respond([fauxAssistantMessage('好')]);
  h.kernel.send(side.id, { text: 'Arc 的竖排标签怎么做\n细节后面说' });
  await h.kernel.settled();
  assert.equal(h.kernel.view(side.id).title, 'Arc 的竖排标签怎么做');
});

test('Model can no longer call legacy open-conversation tool', async () => {
  const h = await harness();
  h.respond([
    fauxAssistantMessage([fauxToolCall('open_side_chat', { title: '旧工具请求', brief: '测试' },
      { id: 'side' })], { stopReason: 'toolUse' }), fauxAssistantMessage('请从队友花名册选择。'),
  ]);
  h.kernel.send('main', { text: '建立一个队友' });
  await h.kernel.settled();
  assert.equal(h.kernel.list({ kind: 'side', limit: 5 }).length, 0);
  assert.equal(h.kernel.read('main', 20).messages.find((message) => message.role === 'toolResult')?.ok, false);
});

test('Reply-to passes target quote to model; UI shows reply header, raw text unprefixed', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage('找到一个细节：收入门槛今年改成按月算了。\n\n别的照旧。')]);
  h.kernel.send('main', { text: '查一下签证' });
  await h.kernel.settled();
  let said = '';
  h.respond([(context) => {
    const last = context.messages.at(-1);
    said = last?.role === 'user' && typeof last.content === 'string' ? last.content : '';
    return fauxAssistantMessage('那就按月平均。');
  }]);
  const sent = h.kernel.send('main', { text: '我是按项目结的', replyTo: 2 });
  await h.kernel.settled();
  assert.ok(said.startsWith('［回复Plasticine（第 2 条）：「找到一个细节：收入门槛今年改成按月算了。」］'));
  assert.ok(said.endsWith('我是按项目结的'));
  assert.deepEqual(sent.message?.replyTo, { seq: 2, author: 'Plasticine', text: '找到一个细节：收入门槛今年改成按月算了。' });
  assert.equal(sent.message?.text, '我是按项目结的');
  assert.throws(() => h.kernel.send('main', { text: '回不存在的', replyTo: 99 }), /不在这条线上/);
});

test('Reactions support adding, adding another, and removing alongside messages', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage('好')]);
  h.kernel.send('main', { text: '在吗' });
  await h.kernel.settled();
  h.kernel.react('main', { seq: 2, emoji: '👍', on: true });
  h.kernel.react('main', { seq: 2, emoji: '🎉', on: true });
  const message = h.kernel.react('main', { seq: 2, emoji: '👍', on: false });
  assert.deepEqual(message.reactions, ['🎉']);
  assert.deepEqual(h.kernel.read('main', 5).messages.at(-1)?.reactions, ['🎉']);
});
