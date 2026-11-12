// 笔记正文和 Markdown：存下来的不带 HTML 实体；复制出去是 Markdown；粘进来的 Markdown 变成对应的格式；
// 中文里直接键入的记号照样转换，撤销一步回到键入的原样。

import { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { noteExtensions } from '../../../src/views/notes/editor-extensions.ts';
import { looksLikeMarkdown, plainWrapped, readableMarkdown } from '../../../src/views/notes/note-markdown.ts';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function load(markdown: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: noteExtensions(), content: markdown,
    contentType: 'markdown' });
  return editor;
}

/** 像真的打字那样一个字一个字交给输入规则；规则没接手的字自己插进去。 */
function type(target: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = target.state.selection;
    const handled = target.view.someProp('handleTextInput', (handle) => handle(target.view, from, to, char,
      () => target.state.tr.insertText(char, from, to)));
    if (handled !== true) {
      target.view.dispatch(target.state.tr.insertText(char, from, to));
    }
  }
}

function pressEnter(target: Editor): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  return target.view.someProp('handleKeyDown', (handle) => handle(target.view, event)) === true;
}

function paste(target: Editor, data: Record<string, string>): boolean {
  const clipboardData = { files: [], getData: (type: string) => data[type] ?? '' };
  const event = { clipboardData, preventDefault: () => undefined } as unknown as ClipboardEvent;
  return target.view.someProp('handlePaste', (handle) => handle(target.view, event, Slice.empty)) === true;
}

/** 选中正文里第一次出现的这段字（不给就全选），返回复制时放进剪贴板的纯文本。 */
function copied(target: Editor, text?: string): string {
  if (text === undefined) {
    target.commands.selectAll();
  } else {
    let from = -1;
    target.state.doc.descendants((node, pos) => {
      const index = node.isText ? (node.text ?? '').indexOf(text.slice(0, 1)) : -1;
      if (from < 0 && node.isTextblock && node.textContent.includes(text)) {
        from = pos + 1 + node.textContent.indexOf(text);
      }
      return index < 0;
    });
    target.view.dispatch(target.state.tr.setSelection(TextSelection.create(target.state.doc, from, from + text.length)));
  }
  const slice = target.state.selection.content();
  return target.view.someProp('clipboardTextSerializer', (serialize) => serialize(slice, target.view)) ?? '';
}

function types(target: Editor): string[] {
  return (target.getJSON().content ?? []).map((node) => `${node.type}${String(node.attrs?.['level'] ?? '')}`);
}

describe('存下来的 Markdown 不带 HTML 实体', () => {
  it.each([
    ['做不完 > 弄不清结果 > 丢掉进度', '做不完 > 弄不清结果 > 丢掉进度'],
    ['讨论/<批名>.md', '讨论/<批名>.md'],
    ['Tom & Jerry，A&B', 'Tom & Jerry，A&B'],
    ['1 < 2 且 3 > 2', '1 < 2 且 3 > 2'],
  ])('正文「%s」存成「%s」', (text, markdown) => {
    const target = load('');
    target.commands.insertContent({ type: 'text', text });
    expect(target.getMarkdown().trim()).toBe(markdown);
  });

  it.each(['> 开头的大于号', '写 <div> 这种标签', 'a<b 和 </p>', '字面的 &gt; 和 &amp; 和 &#39;', '`a > b` 在代码里',
    '第二行开头\n> 也转义'])('会被当成语法的位置转义，读回来还是原来的字：%s', (text) => {
    const target = load('');
    target.commands.insertContent({ type: 'text', text });
    const markdown = target.getMarkdown();
    expect(load(markdown).getText().trim()).toBe(text);
  });

  it('代码块和行内代码里的实体写法原样不动', () => {
    const markdown = '行内 `&gt;` 不动，外面的 &gt; 还原\n\n```html\n<p>&amp;&lt;</p>\n```\n\n> 引用里 a &gt; b';
    expect(readableMarkdown(markdown)).toBe('行内 `&gt;` 不动，外面的 > 还原\n\n```html\n<p>&amp;&lt;</p>\n```\n\n> 引用里 a > b');
  });

  it('已有笔记里的实体读进来再存出去变成平常的字，正文不变', () => {
    const target = load('做不完 &gt; 弄不清结果，见 讨论/&lt;批名&gt;.md');
    expect(target.getText()).toBe('做不完 > 弄不清结果，见 讨论/<批名>.md');
    expect(target.getMarkdown().trim()).toBe('做不完 > 弄不清结果，见 讨论/<批名>.md');
  });
});

describe('复制出去是 Markdown', () => {
  it('跨块选中带标题、列表、引用和加粗的记号', () => {
    const target = load('# 标题\n\n- 一项\n- 两项\n\n> 引用 **粗** a > b');
    expect(copied(target))
      .toBe('# 标题\n\n- 一项\n- 两项\n\n> 引用 **粗** a > b');
  });

  it('只选一个块里的一段字：带行内格式，不带这个块自己的记号', () => {
    const target = load('## 小标题里有**重点**两个字\n\n- 列表里的一项');
    expect(copied(target, '小标题里有重点')).toBe('小标题里有**重点**');
    expect(copied(target, '的一项')).toBe('的一项');
  });

  it('代码块里选中的字原样复制', () => {
    const target = load('```js\nconst a = b > c && d;\n```');
    expect(copied(target, 'a = b > c && d;')).toBe('a = b > c && d;');
  });
});

describe('粘贴 Markdown', () => {
  const sample = '# 标题\n\n- 一项\n- 两项\n\n> 引用\n\n```js\nconst a = 1;\n```\n\n**粗** 和 [链接](https://example.com)';

  it('纯文本是 Markdown：按格式放进来，撤销一步回到粘贴前，重做回来', () => {
    const target = load('前面一段');
    target.commands.focus('end');
    expect(paste(target, { 'text/plain': sample })).toBe(true);
    expect(types(target)).toEqual(expect.arrayContaining(['heading1', 'bulletList', 'blockquote', 'codeBlock']));
    expect(JSON.stringify(target.getJSON())).toContain('"type":"bold"');
    target.commands.undo();
    expect(target.getText().trim()).toBe('前面一段');
    target.commands.redo();
    expect(types(target)).toContain('heading1');
  });

  it('代码编辑器复制的（HTML 只是把同一段字包了 div / span）也按 Markdown', () => {
    const target = load('');
    const html = '<div style="font-family: monospace"><div><span># 标题</span></div><div><span>- 一项</span></div></div>';
    expect(paste(target, { 'text/plain': '# 标题\n- 一项', 'text/html': html })).toBe(true);
    expect(types(target)).toEqual(expect.arrayContaining(['heading1', 'bulletList']));
  });

  it('真的富文本、平常的一句话、光标在代码块里：交回编辑器照常处理', () => {
    const rich = load('');
    expect(paste(rich, { 'text/plain': '# 标题', 'text/html': '<h1>标题</h1>' })).toBe(false);
    const plain = load('');
    expect(paste(plain, { 'text/plain': '今天 3*4=12，周五见。' })).toBe(false);
    const code = load('```\ncode\n```');
    code.commands.setTextSelection(3);
    expect(paste(code, { 'text/plain': '# 不是标题' })).toBe(false);
  });

  it('认不认得出 Markdown', () => {
    expect(looksLikeMarkdown('## 小标题')).toBe(true);
    expect(looksLikeMarkdown('1. 第一\n2. 第二')).toBe(true);
    expect(looksLikeMarkdown('这句里有 **重点**')).toBe(true);
    expect(looksLikeMarkdown('普通的一句话，没有记号。')).toBe(false);
    expect(looksLikeMarkdown('C# 和 #1 都不是标题')).toBe(false);
    expect(plainWrapped('<div><span>a</span><br></div>')).toBe(true);
    expect(plainWrapped('<p>a <strong>b</strong></p>')).toBe(false);
  });
});

describe('中文里直接键入 Markdown', () => {
  it.each([
    ['这是**加粗**', 'bold', '这是加粗'],
    ['这是*斜体*', 'italic', '这是斜体'],
    ['这是~~删除~~', 'strike', '这是删除'],
    ['句号后。**也行**', 'bold', '句号后。也行'],
  ])('记号前面是中文也转：%s', (input, mark, text) => {
    const target = load('');
    type(target, input);
    expect(target.getText()).toBe(text);
    expect(JSON.stringify(target.getJSON())).toContain(`"type":"${mark}"`);
    target.commands.undo();
    expect(target.getText()).toBe(input);
  });

  it('不是强调的写法不动：乘号、单个星号、记号里外有空格', () => {
    for (const input of ['3*4*5', '路径 a*b', '波浪 ~约 5 分钟~', '两个星号**之间有空格 **']) {
      const target = load('');
      type(target, input);
      expect(target.getText()).toBe(input);
      target.destroy();
    }
    editor = null;
  });

  it.each([
    ['》 引用', 'blockquote'],
    ['1。 第一项', 'orderedList'],
    ['3、 从三开始', 'orderedList'],
    ['【】 待办', 'taskList'],
    ['【x】 做完的', 'taskList'],
    ['··· 代码', 'codeBlock'],
    ['## 小标题', 'heading2'],
    ['- 一项', 'bulletList'],
  ])('中文输入法下的写法：%s → %s', (input, expected) => {
    const target = load('');
    type(target, input);
    expect(types(target)[0]).toBe(expected);
    expect(target.getText()).not.toMatch(/[》【】·#]/);
  });

  it('编号从键入的数字开始，待办带上勾选状态', () => {
    const ordered = load('');
    type(ordered, '3、 从三开始');
    expect(ordered.getJSON().content?.[0]?.attrs?.['start']).toBe(3);
    const done = load('');
    type(done, '【x】 做完的');
    expect(JSON.stringify(done.getJSON())).toContain('"checked":true');
  });

  it.each([['```', null], ['```ts', 'ts'], ['···', null], ['~~~py', 'py']])(
    '「%s」后直接回车开代码块', (fence, language) => {
      const target = load('');
      type(target, fence);
      expect(pressEnter(target)).toBe(true);
      expect(types(target)[0]).toBe('codeBlock');
      expect(target.getJSON().content?.[0]?.attrs?.['language'] ?? null).toBe(language);
      expect(target.getText().trim()).toBe('');
    });

  it('平常的回车不受影响', () => {
    const target = load('');
    type(target, '普通的一行');
    pressEnter(target);
    expect(types(target)).toEqual(['paragraph', 'paragraph']);
  });
});
