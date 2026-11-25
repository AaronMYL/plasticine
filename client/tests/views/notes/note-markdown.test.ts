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
    target.view.dispatch(target.state.tr.setSelection(TextSelection.create(target.state.doc, from, from
      + text.length)));
  }
  const slice = target.state.selection.content();
  return target.view.someProp('clipboardTextSerializer', (serialize) => serialize(slice, target.view)) ?? '';
}

function types(target: Editor): string[] {
  return (target.getJSON().content ?? []).map((node) => `${node.type}${String(node.attrs?.['level'] ?? '')}`);
}

describe('saved Markdown contains no HTML entities', () => {
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

  it('preserves HTML entity syntax verbatim inside code blocks and inline code', () => {
    const markdown = '行内 `&gt;` 不动，外面的 &gt; 还原\n\n```html\n<p>&amp;&lt;</p>\n```\n\n> 引用里 a &gt; b';
    expect(readableMarkdown(markdown)).toBe('行内 `&gt;` 不动，外面的 > 还原\n\n```html\n<p>&amp;&lt;</p>\n```\n\n> 引用里 a > b');
  });

  it('normalizes entities in existing notes back to plain characters on save without altering body', () => {
    const target = load('做不完 &gt; 弄不清结果，见 讨论/&lt;批名&gt;.md');
    expect(target.getText()).toBe('做不完 > 弄不清结果，见 讨论/<批名>.md');
    expect(target.getMarkdown().trim()).toBe('做不完 > 弄不清结果，见 讨论/<批名>.md');
  });
});

describe('Copying outputs Markdown', () => {
  it('cross-block selection includes heading, list, quote, and bold syntax', () => {
    const target = load('# 标题\n\n- 一项\n- 两项\n\n> 引用 **粗** a > b');
    expect(copied(target))
      .toBe('# 标题\n\n- 一项\n- 两项\n\n> 引用 **粗** a > b');
  });

  it('single-block partial selection keeps inline formatting without block marker', () => {
    const target = load('## 小标题里有**重点**两个字\n\n- 列表里的一项');
    expect(copied(target, '小标题里有重点')).toBe('小标题里有**重点**');
    expect(copied(target, '的一项')).toBe('的一项');
  });

  it('copies selected text inside code block verbatim', () => {
    const target = load('```js\nconst a = b > c && d;\n```');
    expect(copied(target, 'a = b > c && d;')).toBe('a = b > c && d;');
  });
});

describe('Pasting Markdown', () => {
  const sample = '# 标题\n\n- 一项\n- 两项\n\n> 引用\n\n```js\nconst a = 1;\n```\n\n**粗** 和 [链接](https://example.com)';

  it('inserts plain-text Markdown formatted with single-step undo and redo', () => {
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

  it('treats code-editor HTML wrapping plain text in div/span as Markdown', () => {
    const target = load('');
    const html = '<div style="font-family: monospace"><div><span># 标题</span></div><div><span>- 一项</span></div></div>';
    expect(paste(target, { 'text/plain': '# 标题\n- 一项', 'text/html': html })).toBe(true);
    expect(types(target)).toEqual(expect.arrayContaining(['heading1', 'bulletList']));
  });

  it('delegates true rich text, plain sentences, and paste inside code block back to editor', () => {
    const rich = load('');
    expect(paste(rich, { 'text/plain': '# 标题', 'text/html': '<h1>标题</h1>' })).toBe(false);
    const plain = load('');
    expect(paste(plain, { 'text/plain': '今天 3*4=12，周五见。' })).toBe(false);
    const code = load('```\ncode\n```');
    code.commands.setTextSelection(3);
    expect(paste(code, { 'text/plain': '# 不是标题' })).toBe(false);
  });

  it('detects whether text is Markdown', () => {
    expect(looksLikeMarkdown('## 小标题')).toBe(true);
    expect(looksLikeMarkdown('1. 第一\n2. 第二')).toBe(true);
    expect(looksLikeMarkdown('这句里有 **重点**')).toBe(true);
    expect(looksLikeMarkdown('普通的一句话，没有记号。')).toBe(false);
    expect(looksLikeMarkdown('C# 和 #1 都不是标题')).toBe(false);
    expect(plainWrapped('<div><span>a</span><br></div>')).toBe(true);
    expect(plainWrapped('<p>a <strong>b</strong></p>')).toBe(false);
  });
});

describe('Direct Markdown typing in Chinese', () => {
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

  it('leaves non-emphasis syntax untouched: multiplication, single asterisk, spaced markers', () => {
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

  it('ordered list starts at typed number and checklist preserves checked state', () => {
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

  it('regular Enter key behavior is unaffected', () => {
    const target = load('');
    type(target, '普通的一行');
    pressEnter(target);
    expect(types(target)).toEqual(['paragraph', 'paragraph']);
  });
});
