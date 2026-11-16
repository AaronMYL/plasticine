import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasText } from '../src/tabs/tab-dom.ts';

// 11-16 tab_wait：每半秒问一次页面上看得到的字里有没有这一段。
test('页面看得到的字里有这一段才算有；没有正文也不出错', () => {
  const page = (text: string | null) => ({ body: text === null ? null : { innerText: text } }) as unknown as Document;
  assert.deepEqual(hasText(page('已发送 · 杨崇义'), '已发送'), { found: true });
  assert.deepEqual(hasText(page('正在发送…'), '已发送'), { found: false });
  assert.deepEqual(hasText(page(null), '已发送'), { found: false });
});
