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
  if (system?.role !== 'system') {
    return [];
  }
  const prompt = typeof system.content === 'string' ? system.content : system.content.map((part) => part.text).join('');
  const listed = /本轮实际可用工具：([^。\n]*)。/u.exec(prompt)?.[1]?.split('、') ?? [];
  return [...(system.toolsAdded ?? []).map((tool) => tool.name), ...listed];
}

async function messages(t: TestApp, cookie: string) {
  return json(await call(t, 'GET', `${linePath('main')}?limit=50`, { cookie }))['messages'] as
    { role: string; tool: string | null; text: string; ok: boolean | null; say: string | null;
      widgets: { kind: string }[] }[];
}

test('model tools include kept set (unified server cmd, remember, ask, line tools) and none removed', async () => {
  let seen: string[] = [];
  const { t, cookie } = await toolApp([(context) => {
    seen = offered(context);
    return fauxAssistantMessage('看到了。');
  }]);
  await send(t, cookie, '你有哪些工具');
  for (const name of ['ask_user', 'start_line', 'list_lines', 'read_line', 'tell_line', 'line_pause', 'remember',
    'forget', 'schedule_propose', 'schedule_list', 'schedule_change', 'suggest',
    'server_command', 'note_append', 'read_project', 'device_action', 'cloud_browser_open', 'list_inbox', 'book_read',
    'propose_payment', 'attachment_text', 'show_widgets', 'skill_read', 'get_time', 'web_search', 'web_fetch',
    'file_save', 'reply_files', 'tab_upload', 'device_file_get', 'device_file_put', 'tab_handoff',
    'line_wake_later', 'watch_start', 'watch_stop']) {
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

test('reuses legacy tool execution logic: save and search notes with plain-language step summaries', async () => {
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

test('server command: dry-run records only; allowlisted host without SSH reports clear reason', async () => {
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

test('server command tool description notes PowerShell on Windows and bash elsewhere', async () => {
  const { t } = await toolApp([]);
  const tool = t.app.deps.lines.preview(t.app.deps.state.lines.main().id).all
    .find((each) => each.name === 'server_command');
  const description = tool?.description ?? '';
  assert.match(description, /Windows 上是 PowerShell，别的是 bash/);
  assert.doesNotMatch(description, /Runs a bash script/);
  assert.match(JSON.stringify(tool?.parameters ?? {}), /PowerShell on Windows, bash elsewhere/);
});

test('card widget renders below reply with step result carrying widget payload', async () => {
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

test('remember tool links back to owner\'s quote in that line; skips if quote not found', async () => {
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

test('delegated and web materials cannot be remembered as owner\'s quote even with user role', async () => {
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

test('server-injected quote blocks do not count as owner\'s own words', async () => {
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
