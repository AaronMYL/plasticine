import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from 'typebox';
import { DEFAULT_MAX_RESULT_CHARS } from '../../../shared/tools.ts';
import { defineTool, ToolRegistry, type Tool } from '../../../src/brain/tools/registry.ts';
import { countingTool } from '../helpers.ts';

test('同名工具注册两次时抛错，第一份保留', () => {
  const registry = new ToolRegistry();
  registry.register(countingTool('lookup').tool);
  assert.throws(() => registry.register(countingTool('lookup', { label: '另一个' }).tool), /lookup.*已注册/);
  assert.equal(registry.get('lookup')?.label, '测试工具 lookup');
});

test('只有 effect=read 的工具可以并行；写类工具标 parallel 时注册被拒', () => {
  const registry = new ToolRegistry();
  registry.register(countingTool('read_a', { parallel: true }).tool);
  const writer = countingTool('write_a', { effect: 'internal', parallel: true }).tool;
  assert.throws(() => registry.register(writer), /parallel/);
  assert.equal(registry.get('write_a'), undefined);
});

test('没有参数 schema、或参数 schema 不是 object 时注册被拒', () => {
  const registry = new ToolRegistry();
  const base = countingTool('no_schema').tool;
  const missing: Tool = { ...base, parameters: Type.String() };
  assert.throws(() => registry.register(missing), /参数 schema/);
});

test('定义字段不合格式时注册被拒（名字、超时、角色）', () => {
  const registry = new ToolRegistry();
  assert.throws(() => registry.register(countingTool('Bad-Name').tool), /name/);
  assert.throws(() => registry.register(countingTool('zero_timeout', { timeoutMs: 0 }).tool), /timeoutMs/);
  assert.throws(() => registry.register(countingTool('no_roles', { roles: [] }).tool), /roles/);
});

test('验收轮只能看到只读工具：给 verifier 的写类工具注册被拒', () => {
  const registry = new ToolRegistry();
  const writer = countingTool('note_down', { effect: 'internal', roles: ['worker', 'verifier'] }).tool;
  assert.throws(() => registry.register(writer), /verifier/);
});

test('不写 parallel 和 maxResultChars 时取默认：顺序执行、结果上限 10000 字', () => {
  const { tool } = countingTool('defaults');
  assert.equal(tool.parallel, false);
  assert.equal(tool.maxResultChars, DEFAULT_MAX_RESULT_CHARS);
  assert.equal(DEFAULT_MAX_RESULT_CHARS, 10_000);
});

test('按角色过滤工具，并生成给模型的定义：只有名字、说明和纯 JSON 的参数 schema', () => {
  const registry = new ToolRegistry();
  registry.register(countingTool('everyone').tool);
  registry.register(countingTool('worker_only', { roles: ['worker'] }).tool);
  const tool = defineTool({
    name: 'with_args',
    label: '带参数',
    description: 'Takes a city.',
    replay: 'safe',
    effect: 'read',
    permission: 'auto',
    roles: ['conversation'],
    timeoutMs: 1_000,
    parameters: Type.Object({ city: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    execute: async (args) => args.city,
  });
  registry.register(tool);
  const names = (role: Parameters<ToolRegistry['forRole']>[0]): string[] => {
    return registry.forRole(role).map((entry) => entry.name);
  };
  assert.deepEqual(names('conversation'), ['everyone', 'with_args']);
  assert.deepEqual(names('worker'), ['everyone', 'worker_only']);
  const definition = registry.definitionsFor('conversation').find((entry) => entry.name === 'with_args');
  assert.deepEqual(definition, {
    name: 'with_args',
    description: 'Takes a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string', minLength: 1 } },
      required: ['city'],
      additionalProperties: false,
    },
  });
  assert.equal(registry.isOffered('worker_only', 'conversation'), false);
  assert.equal(registry.isOffered('worker_only', 'worker'), true);
});

test('defineTool 包出来的执行函数拒绝没校验过的参数，不把错参数交给工具', async () => {
  const { tool, runs } = countingTool('strict');
  await assert.rejects(tool.execute({ extra: 1 }, {
    signal: new AbortController().signal,
    runId: 'run-1',
    callId: 'call-1',
    actionId: null,
    now: () => new Date(),
  }), /参数/);
  assert.equal(runs(), 0);
});
