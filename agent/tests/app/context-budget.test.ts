// 上下文预算（内核优化第四批，11-17）：主线第一次请求带的系统提示和工具声明不能悄悄涨回去。
// 第四批以前：系统提示 6,975 字，116 件工具声明 9.1 万字符；之后：20 件、约 1.8 万字符。
// 涨过这里的上限先想清楚：新工具放按需（tool_search 找），长说明挪进技能或工具结果里。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModels, fauxAssistantMessage, fauxProvider, getCurrentTools, type Context,
  type TranscriptContext } from '@earendil-works/pi-ai';
import { lineMessagesPath } from '../../shared/api/index.ts';
import type { ModelSource } from '../../src/lines/index.ts';
import { call, pair, startTestApp } from './helpers.ts';

const BUDGET = { promptChars: 9_000, tools: 21, toolChars: 22_000 };

const chars = (value: unknown): number => Array.from(typeof value === 'string' ? value : JSON.stringify(value)).length;

test('主线第一次请求：系统提示、工具件数、工具声明都在预算里', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const seen: TranscriptContext[] = [];
  const source: ModelSource = {
    current: () => ({ model: faux.getModel(), thinking: 'off' }),
    streamFn: (model, context, options) => {
      seen.push(context as TranscriptContext);
      return models.streamSimple(model, context as Context, options);
    },
    complete: (model, context) => models.completeSimple(model, context),
  };
  const t = await startTestApp([], { lines: { models: source }, dryRun: false, startTasks: false });
  try {
    const cookie = await pair(t);
    faux.appendResponses([fauxAssistantMessage('好的。')]);
    await call(t, 'POST', lineMessagesPath('main'), { cookie, body: { requestId: 'budget-0001', text: '你好' } });
    await t.app.deps.lines?.settled();
    const first = seen[0];
    assert.ok(first !== undefined, '发过一次请求');
    const system = first.messages[0];
    const prompt = system?.role === 'system' ? system.content : '';
    const tools = getCurrentTools(first.messages);
    const toolChars = tools.reduce((sum, tool) => sum + chars(tool.name) + chars(tool.description)
      + chars(tool.parameters), 0);
    assert.ok(chars(prompt) <= BUDGET.promptChars, `系统提示 ${chars(prompt)} 字，上限 ${BUDGET.promptChars}`);
    assert.ok(tools.length <= BUDGET.tools, `一开始声明 ${tools.length} 件，上限 ${BUDGET.tools}`);
    assert.ok(toolChars <= BUDGET.toolChars, `工具声明 ${toolChars} 字符，上限 ${BUDGET.toolChars}`);
    assert.ok(tools.some((tool) => tool.name === 'tool_search'), '其余的要找得到');
  } finally {
    await t.close();
  }
});
