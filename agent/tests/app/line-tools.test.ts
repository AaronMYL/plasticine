// 第三级：留下来的旧工具包成新内核的工具，在真的服务里跑（假模型，不联网）。看模型拿到的工具清单、旧工具的执行逻辑
// 原样复用、干跑、卡片小部件、记住一句的来源。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep,
  type TranscriptContext } from '@earendil-works/pi-ai';
import { lineMessagesPath, linePath } from '../../shared/api/index.ts';
import { legacyToolNames, type ModelSource } from '../../src/lines/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
});

async function toolApp(steps: FauxResponseStep[]) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const source: ModelSource = {
    current: () => ({ model: faux.getModel(), thinking: 'off' }),
    streamFn: models.streamSimple.bind(models),
    complete: (model, context) => models.completeSimple(model, context),
  };
  faux.appendResponses(steps);
  const t = await startTestApp([], { lines: { models: source } });
  apps.push(t);
  return { t, cookie: await pair(t), faux };
}

let counter = 0;
async function send(t: TestApp, cookie: string, text: string): Promise<void> {
  counter += 1;
  const reply = await call(t, 'POST', lineMessagesPath('main'), { cookie,
    body: { requestId: `tools-request-${String(counter).padStart(4, '0')}`, text } });
  assert.equal(reply.status, 200);
  await t.app.deps.lines?.settled();
}

function offered(context: TranscriptContext): string[] {
  const system = context.messages.find((message) => message.role === 'system');
  return system?.role === 'system' ? (system.toolsAdded ?? []).map((tool) => tool.name) : [];
}

async function messages(t: TestApp, cookie: string) {
  return json(await call(t, 'GET', `${linePath('main')}?limit=50`, { cookie }))['messages'] as
    { role: string; tool: string | null; text: string; ok: boolean | null; say: string | null;
      widgets: { kind: string }[] }[];
}

test('模型拿到的工具：留下来的都在（服务器命令合成一件、记住一句、问他、线的工具），不移植的一件都没有', async () => {
  let seen: string[] = [];
  const { t, cookie } = await toolApp([(context) => {
    seen = offered(context);
    return fauxAssistantMessage('看到了。');
  }]);
  await send(t, cookie, '你有哪些工具');
  for (const name of ['ask_user', 'start_line', 'list_lines', 'read_line', 'tell_line', 'stop_line', 'remember',
    'forget', 'schedule_propose', 'schedule_list', 'schedule_change', 'suggest',
    'server_command', 'note_append', 'read_project', 'device_action', 'cloud_browser_open', 'list_inbox', 'book_read',
    'propose_payment', 'attachment_text', 'show_widgets', 'skill_read', 'get_time']) {
    assert.ok(seen.includes(name), `有 ${name}`);
  }
  for (const name of ['create_task', 'delegate_task', 'dispatch', 'plan_task', 'list_tasks', 'control_task',
    'task_detail', 'task_evidence', 'task_history', 'report_progress', 'request_input', 'finish_receipt_review',
    'self_iterate', 'capabilities_inspect', 'conversation_history', 'checkpoint_conversation', 'mark_disagreement',
    'server_exec', 'cloud_ssh_run', 'remember_conversation']) {
    assert.ok(!seen.includes(name), `没有 ${name}`);
  }
  assert.ok(legacyToolNames().length >= 25);
});

test('旧工具的执行逻辑原样复用：记到笔记再找出来，每一步带大白话', async () => {
  const { t, cookie } = await toolApp([
    fauxAssistantMessage([fauxToolCall('note_append', { title: 'CuaDriver.app 是什么', markdown: '签名有效。' },
      { id: 'n1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('note_search', { q: 'CuaDriver' }, { id: 'n2' })],
      { stopReason: 'toolUse' }),
    fauxAssistantMessage('记好了。'),
  ]);
  await send(t, cookie, '记到笔记里');
  const results = (await messages(t, cookie)).filter((message) => message.role === 'toolResult');
  assert.deepEqual(results.map((message) => [message.tool, message.ok]),
    [['note_append', true], ['note_search', true]]);
  assert.equal(results[0]?.say, '记到笔记：CuaDriver.app 是什么');
  assert.ok(results[1]?.text.includes('CuaDriver.app 是什么'));
  const notes = t.state.notes.list({ q: 'CuaDriver' }, { limit: 10 });
  assert.equal(notes.length, 1);
});

test('服务器命令：开发期干跑只记不跑；名单上的主机没接 SSH 时说清楚', async () => {
  const { t, cookie } = await toolApp([
    fauxAssistantMessage([fauxToolCall('server_command', { script: 'echo hi' }, { id: 's1' }),
      fauxToolCall('server_command', { script: 'uptime', host: 'aliyun' }, { id: 's2' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('好。'),
  ]);
  await send(t, cookie, '跑一下');
  const results = (await messages(t, cookie)).filter((message) => message.role === 'toolResult');
  assert.ok(results[0]?.text.startsWith('干跑：'), results[0]?.text);
  assert.equal(results[0]?.say, '在服务器上跑命令');
  assert.equal(results[1]?.ok, false);
  assert.ok(results[1]?.text.includes('SSH'));
  assert.equal(results[1]?.say, '在 aliyun 上跑命令');
});

test('服务器命令的说明写明 Windows 上是 PowerShell、别处是 bash（安装包在 Windows 上跑）', async () => {
  let description = '';
  let scriptHint = '';
  const { t, cookie } = await toolApp([(context) => {
    const system = context.messages.find((message) => message.role === 'system');
    const tool = system?.role === 'system' ? system.toolsAdded?.find((each) => each.name === 'server_command')
      : undefined;
    description = tool?.description ?? '';
    scriptHint = JSON.stringify(tool?.parameters ?? {});
    return fauxAssistantMessage('看到了。');
  }]);
  await send(t, cookie, '看看服务器命令');
  assert.match(description, /PowerShell on Windows, bash elsewhere/);
  assert.doesNotMatch(description, /Runs a bash script/);
  assert.match(scriptHint, /PowerShell on Windows, bash elsewhere/);
});

test('卡片小部件：放在回复下面，线里那一步的结果带着部件', async () => {
  const { t, cookie } = await toolApp([
    fauxAssistantMessage([fauxToolCall('show_widgets', { widgets: [{ kind: 'choice', prompt: '周五还是周六？',
      options: [{ label: '周五' }, { label: '周六' }] }] }, { id: 'w1' })],
    { stopReason: 'toolUse' }),
    fauxAssistantMessage('选一个。'),
  ]);
  await send(t, cookie, '约个时间');
  const result = (await messages(t, cookie)).find((message) => message.role === 'toolResult');
  assert.equal(result?.ok, true);
  assert.deepEqual(result?.widgets.map((widget) => widget.kind), ['choice']);
});

test('记住一句：链回他在这条线里说的那句原话；找不到原话就不记', async () => {
  const { t, cookie } = await toolApp([
    fauxAssistantMessage([fauxToolCall('remember', { text: '喜欢早上跑步', quote: '早上跑步' }, { id: 'r1' })],
      { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('remember', { text: '喜欢游泳', quote: '游泳' }, { id: 'r2' })],
      { stopReason: 'toolUse' }),
    fauxAssistantMessage('记下了。'),
  ]);
  await send(t, cookie, '我喜欢早上跑步，记一下');
  const results = (await messages(t, cookie)).filter((message) => message.role === 'toolResult');
  assert.equal(results[0]?.ok, true, results[0]?.text);
  assert.equal(results[1]?.ok, false, '他没说过游泳');
  const line = t.state.memoryDocs.lines.allLive().find((row) => row.text === '喜欢早上跑步');
  assert.ok(line !== undefined);
  assert.deepEqual(line.anchors, [{ kind: 'message', ref: 'line:line-main:1' }]);
});

test('后台委派与网络材料即使是 user role，也不能被记成主人的原话', async () => {
  for (const kind of ['delegation', 'network', 'trigger'] as const) {
    const { t } = await toolApp([
      fauxAssistantMessage([fauxToolCall('remember', { text: '喜欢绿色', quote: '喜欢绿色' }, { id: 'remember' })],
        { stopReason: 'toolUse' }),
      fauxAssistantMessage('这是来源材料，没有当作你的偏好。'),
    ]);
    const line = t.app.deps.lines!.open({ title: '处理材料', goal: '材料里写着喜欢绿色', parentLineId: null,
      projectId: null, origin: { kind } });
    await t.app.deps.lines!.settled();
    const result = t.app.deps.lines!.read(line.id, 20).messages.find((row) => row.role === 'toolResult');
    assert.equal(result?.ok, false);
    assert.equal(t.state.memoryDocs.lines.allLive().some((row) => row.text === '喜欢绿色'), false);
  }
});

test('服务端拼入的引文不算用户自己说的话', async () => {
  const { t } = await toolApp([
    fauxAssistantMessage([fauxToolCall('remember', { text: '喜欢绿色', quote: '喜欢绿色' }, { id: 'remember' })],
      { stopReason: 'toolUse' }), fauxAssistantMessage('这段引文没有记成你的偏好。'),
  ]);
  const before = t.state.memoryDocs.lines.allLive();
  t.app.deps.lines!.send('main', { text: '帮我总结。\n引用材料：喜欢绿色。',
    origin: { kind: 'user', userText: '帮我总结。' } });
  await t.app.deps.lines!.settled();
  const result = t.app.deps.lines!.read('main', 20).messages.find((row) => row.role === 'toolResult');
  assert.equal(result?.ok, false);
  assert.deepEqual(t.state.memoryDocs.lines.allLive(), before);
});
