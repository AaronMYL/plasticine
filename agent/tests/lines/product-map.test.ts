import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productMap } from '../../src/lines/product-map.ts';

test('能力地图从当轮注册工具生成，不声称关闭或不存在的工具能用', () => {
  const tools = [{ name: 'space_edit' }, { name: 'note_update' }, { name: 'library_batch' }];
  const text = productMap(tools);
  assert.match(text, /工具：space_edit、library_batch/);
  assert.match(text, /笔记：用户写的文字。工具：note_update/);
  assert.doesNotMatch(text, /space_write|open_side_chat/);
  const listed = text.match(/本轮实际可用工具：(.*)。/)?.[1]?.split('、');
  assert.deepEqual(listed, tools.map((tool) => tool.name));
});
