import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { tabHandoffTool, type KernelTool, type ToolArgs } from '../../src/lines/index.ts';
import { startKernel, until, type Harness } from './helpers.ts';

const open: Harness[] = [];

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

function lastResult(context: TranscriptContext): string {
  const results = context.messages.filter((message) => message.role === 'toolResult');
  const last = results[results.length - 1];
  return last?.role === 'toolResult' ? last.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
    : '';
}

test('tab_handoff switches tab then shows card and waits until user clicks done', async () => {
  const shown: ToolArgs[] = [];
  const deviceAction: KernelTool = { name: 'device_action', say: () => '设备动作', hardLine: () => null,
    create: () => ({ name: 'device_action', label: '设备动作', description: '', parameters: {} as never,
      async execute(_callId, args) {
        shown.push(args as ToolArgs);
        return { content: [{ type: 'text', text: '{"status":"executed"}' }], details: {} };
      } }) };
  const h = await startKernel({ extra: { askTools: [(host) => tabHandoffTool(host, deviceAction)] } });
  open.push(h);
  h.respond([
    fauxAssistantMessage([fauxToolCall('tab_handoff', { nodeId: 'mac-1', tabId: 't-1', what: '扫码登录示例后台' },
      { id: 'hand-1' })], { stopReason: 'toolUse' }),
    (context) => fauxAssistantMessage(`结果：${lastResult(context)}`),
  ]);
  h.kernel.send('main', { text: '去后台发文章' });
  await until(() => h.kernel.view('main').status === 'waiting', '线在等他');
  assert.deepEqual(shown[0]?.['action'], { kind: 'tab_show', tabId: 't-1' });
  const ask = h.handle.state.asks.open()[0];
  assert.equal(ask?.question, '这一步要你来：扫码登录示例后台');
  assert.equal(ask?.kind, 'act');
  assert.deepEqual(ask?.options.map((option) => option.label), ['好了', '做不了']);
  h.desk.answer({ askId: ask?.id ?? '', optionId: 'done', answerer: { deviceId: 'd' } });
  await h.kernel.settled();
  assert.match(h.kernel.view('main').lastAnswer ?? '', /他做完了这一步/);
  assert.equal(shown.length, 1);
});
