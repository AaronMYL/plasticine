import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { getTimeTool } from '../../../src/brain/tools/get-time.ts';
import { ToolRegistry, type ToolContext } from '../../../src/brain/tools/registry.ts';
import { FIXED_NOW } from '../helpers.ts';

const OutputSchema = Type.Object({ iso: Type.String(), timezone: Type.String(), local: Type.String() });

function context(): ToolContext {
  const signal = new AbortController().signal;
  return { signal, runId: 'run-1', callId: 'call-1', actionId: null, now: () => FIXED_NOW };
}

test('get_time 是只读、可并行、自动放行的工具，四种轮次都能用', () => {
  const registry = new ToolRegistry();
  registry.register(getTimeTool);
  assert.equal(getTimeTool.effect, 'read');
  assert.equal(getTimeTool.replay, 'safe');
  assert.equal(getTimeTool.parallel, true);
  assert.equal(getTimeTool.permission, 'auto');
  assert.equal(registry.forRole('verifier').length, 1);
});

test('get_time 按给定时区报出当前时间', async () => {
  const output: unknown = JSON.parse(await getTimeTool.execute({ timezone: 'Asia/Shanghai' }, context()));
  assert.ok(Value.Check(OutputSchema, output));
  assert.equal(output.iso, '2026-10-27T08:00:00.000Z');
  assert.equal(output.timezone, 'Asia/Shanghai');
  assert.match(output.local, /16:00/);
});

test('get_time 遇到不认识的时区时报错，说明要什么格式', async () => {
  await assert.rejects(getTimeTool.execute({ timezone: 'Mars/Olympus' }, context()), /IANA/);
});
