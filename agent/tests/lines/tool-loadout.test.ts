import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { fauxAssistantMessage, fauxToolCall, getCurrentTools, type TranscriptContext } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { actionHint, deviceActionFace, HIDDEN_KINDS } from '../../src/devices/device-action-face.ts';
import { declareLoaded, searchCatalog, splitLoadout } from '../../src/lines/tool-loadout.ts';
import { adaptLegacyTool } from '../../src/lines/index.ts';
import { defineTool } from '../../src/tools/index.ts';
import { echoTool, mailTool, startKernel, until, type Harness } from './helpers.ts';

const open: Harness[] = [];
afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

function agentTool(name: string): AgentTool {
  return { name, label: name, description: `${name} 的说明`, parameters: Type.Object({}),
    execute: async () => ({ content: [], details: {} }) };
}

test('Splits tools into upfront and on-demand; declares all upfront if no core list', () => {
  const tools = ['echo', 'send_mail', 'tool_search'].map(agentTool);
  assert.deepEqual([...splitLoadout(tools, undefined).deferred.keys()], []);
  const split = splitLoadout(tools, new Set(['echo']));
  assert.deepEqual(split.declared.map((tool) => tool.name), ['echo', 'tool_search']);
  assert.deepEqual([...split.deferred.keys()], ['send_mail']);
});

test('Tool declarations inject into history once before use or after search result', () => {
  const deferred = new Map([['send_mail', agentTool('send_mail')], ['note_read', agentTool('note_read')]]);
  const call = (name: string, id: string): AgentMessage => fauxAssistantMessage([fauxToolCall(name, {}, { id })],
    { stopReason: 'toolUse' });
  const history: AgentMessage[] = [
    { role: 'user', content: '发封信', timestamp: 1 },
    call('tool_search', 's1'),
    { role: 'toolResult', toolCallId: 's1', toolName: 'tool_search', content: [], isError: false,
      details: { loaded: ['send_mail'] }, timestamp: 2 },
    call('send_mail', 'm1'),
    call('note_read', 'n1'),
  ];
  const out = declareLoaded(history, deferred);
  const roles = out.map((message) => message.role);
  assert.deepEqual(roles, ['user', 'assistant', 'toolResult', 'system', 'assistant', 'system', 'assistant']);
  assert.deepEqual(getCurrentTools(out as never).map((tool) => tool.name), ['send_mail', 'note_read']);
});

test('Tool search ranks exact name matches first and matches Chinese bigrams', () => {
  const catalog = [
    { name: 'note_search', label: '搜笔记', description: '按关键词搜他的笔记。' },
    { name: 'note_read', label: '读笔记', description: '读一篇笔记全文。' },
    { name: 'send_mail', label: '发信', description: '以他的名义发一封邮件。' },
  ];
  assert.deepEqual(searchCatalog(catalog, 'note_read').map((entry) => entry.name)[0], 'note_read');
  assert.deepEqual(searchCatalog(catalog, '发邮件').map((entry) => entry.name), ['send_mail']);
  assert.deepEqual(searchCatalog(catalog, '天气'), []);
});

test('Line starts with core tools and tool_search; found tools become callable next', async () => {
  const sent: string[] = [];
  const directTools = { main: ['echo'], side: ['echo'], background: ['echo'] };
  const h = await startKernel({ tools: [echoTool(), mailTool(sent)], extra: { directTools } });
  open.push(h);
  const declared: string[][] = [];
  const seen = (context: TranscriptContext): void => {
    declared.push(getCurrentTools(context.messages).map((tool) => tool.name));
  };
  h.respond([
    (context) => {
      seen(context);
      return fauxAssistantMessage([fauxToolCall('tool_search', { query: 'send_mail' }, { id: 's1' })],
        { stopReason: 'toolUse' });
    },
    (context) => {
      seen(context);
      return fauxAssistantMessage('找到了。');
    },
  ]);
  h.kernel.send('main', { text: '发封信' });
  await until(() => h.kernel.view('main').lastAnswer === '找到了。', '答完');
  assert.deepEqual(declared[0]?.sort(), ['echo', 'tool_search']);
  assert.ok(declared[1]?.includes('send_mail'), '找到的从下一次请求起声明');
  assert.match(h.kernel.read('main', 20).messages.find((message) => message.role === 'toolResult')?.text ?? '',
    /send_mail/);
});

test('device_action model schema uses kind enum, omits tab_click, much shorter', () => {
  const face = JSON.parse(JSON.stringify(deviceActionFace())) as {
    properties: { action: { properties: { kind: { enum: string[] } } } };
  };
  const kinds = face.properties.action.properties.kind.enum;
  assert.ok(kinds.includes('tab_act') && kinds.includes('run_command'));
  for (const hidden of HIDDEN_KINDS) {
    assert.equal(kinds.includes(hidden), false, hidden);
  }
  assert.ok(JSON.stringify(face).length < 6_000);
  assert.match(actionHint({ action: { kind: 'tab_read' } }) ?? '', /tab_read\(tabId:str,offset:int\)/);
  assert.match(actionHint({ action: { kind: 'nope' } }) ?? '', /没有这种动作/);
});

test('Loose pass + strict fail skips execution and returns invalid field/required args', async () => {
  let ran = 0;
  const strict = Type.Object({ action: Type.Object({ kind: Type.Literal('a'), n: Type.Integer() },
    { additionalProperties: false }) }, { additionalProperties: false });
  const tool = defineTool({ name: 'act', label: '做', description: '做一下', replay: 'once', effect: 'internal',
    permission: 'auto', roles: ['conversation'], timeoutMs: 1_000, parameters: strict,
    declared: Type.Object({ action: Type.Object({ kind: Type.String() }, { additionalProperties: true }) }),
    argsHint: () => '这一种要：a(n:int)。',
    execute: async () => {
      ran += 1;
      return '做了';
    } });
  const agent = adaptLegacyTool(tool, { say: () => '做' }, { dryRun: false, now: () => new Date() })
    .create({ lineId: 'l', kind: 'main', projectId: null });
  assert.equal(agent.parameters, tool.declared);
  await assert.rejects(agent.execute('c1', { action: { kind: 'a', n: 'x' } }), /参数不合要求.*a\(n:int\)/);
  assert.equal(ran, 0);
  const done = await agent.execute('c2', { action: { kind: 'a', n: 1 } });
  assert.equal(done.content[0]?.type === 'text' ? done.content[0].text : '', '做了');
});
