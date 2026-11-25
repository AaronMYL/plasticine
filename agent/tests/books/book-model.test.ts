import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from 'typebox';
import { askJson, dropNulls } from '../../src/books/book-model.ts';
import type { TextModels } from '../../src/kernel/index.ts';

function answering(text: string): { models: TextModels } {
  return { models: { ask: async () => ({ text, complete: true }) } };
}

const Output = Type.Object({
  tell: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  items: Type.Optional(Type.Array(Type.Object({ title: Type.String() }))),
});

test('treats model null as omitted instead of stringifying to \'null\'', async () => {
  const output = await askJson(answering('{"tell":null,"note":"没事","items":[null,{"title":"看一眼"}]}'), Output,
    'system', 'user', AbortSignal.timeout(1_000), 'heartbeat');
  assert.deepEqual(output, { note: '没事', items: [{ title: '看一眼' }] });
});

test('required field set to null still fails schema validation with error instead of guessing', async () => {
  await assert.rejects(askJson(answering('{"items":[{"title":null}]}'), Output, 'system', 'user',
    AbortSignal.timeout(1_000), 'heartbeat'), /格式不对/);
});

test('dropNulls removes only null values and leaves everything else unchanged', () => {
  assert.deepEqual(dropNulls({ a: 0, b: '', c: false, d: null, e: [1, null, { f: null }] }),
    { a: 0, b: '', c: false, e: [1, {}] });
});
