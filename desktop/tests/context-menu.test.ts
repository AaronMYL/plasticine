import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextMenuEntries, type MenuParams } from '../src/app/context-menu-template.ts';

const BASE: MenuParams = { x: 10, y: 20, isEditable: false, selectionText: '', linkURL: '', srcURL: '',
  mediaType: 'none', misspelledWord: '', dictionarySuggestions: [],
  editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: true } };

function labels(params: Partial<MenuParams>): string[] {
  return contextMenuEntries({ ...BASE, ...params }).map((entry) => entry.kind === 'separator' ? '—' : entry.label);
}

test('空白处没有选中什么：不出菜单', () => {
  assert.deepEqual(labels({}), []);
});

test('选中文字：先是「引用到对话」，再是复制', () => {
  assert.deepEqual(labels({ selectionText: '一段话' }), ['引用到对话', '—', '复制']);
  const quote = contextMenuEntries({ ...BASE, selectionText: '一段话' })[0];
  assert.equal(quote?.kind === 'action' ? quote.accelerator : null, 'CmdOrCtrl+Shift+L');
});

test('输入框里：拼写建议、剪切复制粘贴、全选；按能不能用置灰', () => {
  const entries = contextMenuEntries({ ...BASE, isEditable: true, misspelledWord: 'helo',
    dictionarySuggestions: ['hello', 'help'], editFlags: { canCut: false, canCopy: false, canPaste: true,
      canSelectAll: true } });
  assert.deepEqual(entries.map((entry) => entry.kind === 'separator' ? '—' : entry.label),
    ['hello', 'help', '—', '剪切', '复制', '粘贴', '—', '全选']);
  const cut = entries.find((entry) => entry.kind === 'role' && entry.role === 'cut');
  assert.equal(cut?.kind === 'role' ? cut.enabled : null, false);
});

test('链接和图片：复制地址、复制图片', () => {
  assert.deepEqual(labels({ linkURL: 'https://example.com', mediaType: 'image', srcURL: 'https://example.com/a.png' }),
    ['复制链接地址', '—', '复制图片', '复制图片地址']);
});
