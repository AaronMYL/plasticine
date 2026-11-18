// 上下文预算（内核优化第四批，11-17；11-18 按线的种类分）：每种线一开始带的系统提示和工具声明不能悄悄涨回去。
// 第四批以前：系统提示约 7 千字，116 件工具一起声明 9.1 万字符；11-18 起主线、旁聊 14 件约 7.6 千字符，后台线 21 件。
// 涨过这里的上限先想清楚：新工具放按需（tool_search 找），长说明挪进技能或工具结果里（space_write 就是这么瘦的）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModels, fauxProvider, toToolDeclaration } from '@earendil-works/pi-ai';
import { DIRECT_TOOLS, TOOL_SEARCH, type ModelSource } from '../../src/lines/index.ts';
import { startTestApp } from './helpers.ts';

const BUDGET = {
  main: { promptChars: 9_000, tools: 15, toolChars: 9_000 },
  side: { promptChars: 9_000, tools: 15, toolChars: 9_000 },
  background: { promptChars: 9_000, tools: 22, toolChars: 17_500 },
} as const;

const chars = (value: unknown): number => Array.from(typeof value === 'string' ? value : JSON.stringify(value)).length;

test('每种线一开始：名单里的工具都在、系统提示和工具声明都在预算里', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const source: ModelSource = {
    current: () => ({ model: faux.getModel(), thinking: 'off' }),
    streamFn: (model, context, options) => models.streamSimple(model, context, options),
    complete: (model, context) => models.completeSimple(model, context),
  };
  const t = await startTestApp([], { lines: { models: source }, dryRun: false, startTasks: false });
  try {
    const { state, lines } = t.app.deps;
    const main = state.lines.main();
    const ids = {
      main: main.id,
      side: state.lines.create({ kind: 'side', title: '旁聊', parentLineId: main.id, projectId: null }).id,
      background: state.lines.create({ kind: 'background', title: '后台', parentLineId: main.id, projectId: null }).id,
    };
    for (const kind of ['main', 'side', 'background'] as const) {
      const preview = lines.preview(ids[kind]);
      const names = preview.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, [...DIRECT_TOOLS[kind], TOOL_SEARCH].sort(), `${kind}：一开始声明的就是名单上的`);
      const toolChars = preview.tools.map(toToolDeclaration).reduce((sum, tool) => sum + chars(tool.name)
        + chars(tool.description) + chars(tool.parameters), 0);
      const budget = BUDGET[kind];
      assert.ok(chars(preview.prompt) <= budget.promptChars, `${kind} 系统提示 ${chars(preview.prompt)} 字`);
      assert.ok(names.length <= budget.tools, `${kind} 一开始 ${names.length} 件`);
      assert.ok(toolChars <= budget.toolChars, `${kind} 工具声明 ${toolChars} 字符，上限 ${budget.toolChars}`);
    }
  } finally {
    await t.close();
  }
});
