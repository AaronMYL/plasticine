import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from 'typebox';
import { askJson, dropNulls } from '../../src/brain/book-model.ts';
import type { TextModels } from '../../src/kernel/index.ts';

function answering(text: string): { models: TextModels } {
  return { models: { ask: async () => ({ text, complete: true }) } };
}

const Output = Type.Object({
  tell: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  items: Type.Optional(Type.Array(Type.Object({ title: Type.String() }))),
});

test('模型写 null 当成没写，不变成字符串 "null"（11-08 心跳在主线上发了一条「null」）', async () => {
  const output = await askJson(answering('{"tell":null,"note":"没事","items":[null,{"title":"看一眼"}]}'), Output,
    'system', 'user', AbortSignal.timeout(1_000), 'heartbeat');
  assert.deepEqual(output, { note: '没事', items: [{ title: '看一眼' }] });
});

test('必填项是 null 照样过不了 schema：报错，不猜', async () => {
  await assert.rejects(askJson(answering('{"items":[{"title":null}]}'), Output, 'system', 'user',
    AbortSignal.timeout(1_000), 'heartbeat'), /格式不对/);
});

test('dropNulls 只去掉 null，别的原样', () => {
  assert.deepEqual(dropNulls({ a: 0, b: '', c: false, d: null, e: [1, null, { f: null }] }),
    { a: 0, b: '', c: false, e: [1, {}] });
});
