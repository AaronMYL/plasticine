// 笔记编辑器和对话用同一套中日韩友好的强调规则；读进来再存出去，他的笔记原文一字不变。

import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { noteExtensions } from '../../../src/views/notes/editor-extensions.ts';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function load(markdown: string): Editor {
  editor = new Editor({ element: null, extensions: noteExtensions(), content: markdown, contentType: 'markdown' });
  return editor;
}

const SAMPLES = [
  '**这项定时任务还没建成，也没有发出任何消息。**目前只能在对话里提醒你。',
  '先看*这一段。*然后再说。',
  '计划~~周五发布。~~改到下周。',
  '# 标题\n\n普通的一段，带 **加粗** 和 `代码`。',
];

describe('笔记里的中文强调', () => {
  it('标点后紧跟中文的加粗读成加粗', () => {
    const json = JSON.stringify(load(SAMPLES[0]!).getJSON());
    expect(json).toContain('"type":"bold"');
    expect(json).not.toContain('**');
  });

  it.each(SAMPLES)('读进来再存出去字节不变：%s', (markdown) => {
    expect(load(markdown).getMarkdown()).toBe(markdown);
  });
});
