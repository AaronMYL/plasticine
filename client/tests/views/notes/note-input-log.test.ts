// 输入诊断只记事件的种类、长度和位置，不记正文。

import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';
import { noteExtensions } from '../../../src/views/notes/editor-extensions.ts';
import { inputDiagnostics, recordInput } from '../../../src/views/notes/note-input-log.ts';

it('记下组字事件和事务发生在段落的什么位置，导出的文字里没有正文', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: noteExtensions(),
    content: '前半句秘密内容，后半句也是秘密。', contentType: 'markdown' });
  const stop = recordInput(editor, editor.view.dom);
  editor.commands.setTextSelection(9);
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ni hao' }));
  editor.commands.insertContent('你好');
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { data: '你好' }));
  const text = inputDiagnostics(editor, 'build-1');
  const lines = text.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(lines[0]).toMatchObject({ version: 'build-1' });
  expect(lines.some((line) => line['e'] === 'compositionupdate' && line['data'] === '拉丁×6')).toBe(true);
  expect(lines.some((line) => line['e'] === 'compositionend' && line['data'] === '中文×2')).toBe(true);
  expect(lines.some((line) => line['e'] === 'transaction' && line['doc'] === true && line['at'] === 10
    && line['of'] === 18)).toBe(true);
  expect(text).not.toMatch(/秘密|你好|ni hao/);
  stop();
  expect(inputDiagnostics(editor, 'build-1').split('\n')).toHaveLength(1);
  editor.destroy();
});
