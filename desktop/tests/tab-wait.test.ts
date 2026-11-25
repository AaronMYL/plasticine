import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasText } from '../src/tabs/tab-dom.ts';

test('matches snippet only in visible page text and handles empty body without throwing', () => {
  const page = (text: string | null) => ({ body: text === null ? null : { innerText: text } }) as unknown as Document;
  assert.deepEqual(hasText(page('已发送 · 杨崇义'), '已发送'), { found: true });
  assert.deepEqual(hasText(page('正在发送…'), '已发送'), { found: false });
  assert.deepEqual(hasText(page(null), '已发送'), { found: false });
});
