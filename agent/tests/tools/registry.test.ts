import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from 'typebox';
import { DEFAULT_MAX_RESULT_CHARS } from '../../shared/tools.ts';
import { defineTool, ToolRegistry, type Tool } from '../../src/tools/registry.ts';
import { countingTool } from './helpers.ts';

test('Registering duplicate tool name throws while keeping the first registration', () => {
  const registry = new ToolRegistry();
  registry.register(countingTool('lookup').tool);
  assert.throws(() => registry.register(countingTool('lookup', { label: '另一个' }).tool), /lookup.*已注册/);
  assert.equal(registry.get('lookup')?.label, '测试工具 lookup');
});

test('Only effect=read tools allow parallel; registering write tool as parallel fails', () => {
  const registry = new ToolRegistry();
  registry.register(countingTool('read_a', { parallel: true }).tool);
  const writer = countingTool('write_a', { effect: 'internal', parallel: true }).tool;
  assert.throws(() => registry.register(writer), /parallel/);
  assert.equal(registry.get('write_a'), undefined);
});

test('Rejects tool registration missing parameter schema or non-object schema', () => {
  const registry = new ToolRegistry();
  const base = countingTool('no_schema').tool;
  const missing: Tool = { ...base, parameters: Type.String() };
  assert.throws(() => registry.register(missing), /参数 schema/);
});

test('Rejects tool registration with invalid name, timeout, or role fields', () => {
  const registry = new ToolRegistry();
  assert.throws(() => registry.register(countingTool('Bad-Name').tool), /name/);
  assert.throws(() => registry.register(countingTool('zero_timeout', { timeoutMs: 0 }).tool), /timeoutMs/);
  assert.throws(() => registry.register(countingTool('no_roles', { roles: [] }).tool), /roles/);
});

test('Verifier turns see read-only tools only; write tool for verifier is rejected', () => {
  const registry = new ToolRegistry();
  const writer = countingTool('note_down', { effect: 'internal', roles: ['worker', 'verifier'] }).tool;
  assert.throws(() => registry.register(writer), /verifier/);
});

test('Defaults parallel to false and maxResultChars to 10000 when omitted', () => {
  const { tool } = countingTool('defaults');
  assert.equal(tool.parallel, false);
  assert.equal(tool.maxResultChars, DEFAULT_MAX_RESULT_CHARS);
  assert.equal(DEFAULT_MAX_RESULT_CHARS, 10_000);
});

test('Filters tools by role and emits model definitions with name, desc, JSON schema', () => {
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

test('defineTool wrapper rejects unvalidated args before invoking tool handler', async () => {
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
