import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Markdown } from '../../src/primitives/message/markdown.tsx';

it('回复保留标题、嵌套列表、表格、代码、链接及带版本的对象引用', () => {
  const { container } = render(<Markdown text={'## 结论\n\n**重要**\n\n- 一\n  - 二\n\n'
    + '| 项 | 值 |\n| --- | --- |\n| A | 2 |\n\n```ts\nconst n = 2;\n```\n\n'
    + '[出处](https://example.com) 和 [判断:judgment-1@3] [任务:task-1@2]'} />);
  expect(screen.getByRole('heading', { name: '结论', level: 2 })).toBeTruthy();
  expect(container.querySelector('strong')?.textContent).toBe('重要');
  expect(container.querySelectorAll('ul')).toHaveLength(2);
  expect(screen.getByRole('table')).toBeTruthy();
  expect(container.querySelector('pre code')?.textContent).toContain('const n = 2');
  expect(screen.getByRole('link', { name: '出处' }).getAttribute('href')).toBe('https://example.com');
  expect(screen.getByRole('link', { name: '判断 · 第3版' }).getAttribute('href'))
    .toBe('#/memory/judgments/judgment-1');
  expect(screen.getByRole('link', { name: '任务 · 第2版' }).getAttribute('href')).toBe('#/tasks/task-1');
});

it('英文对象引用显示中文名称与版本，完整标识留在提示中且路由不变', () => {
  const id = '6d012f13-2bec-4972-bc59-2a13a23d5d27';
  const reference = `[judgment:${id}@1]`;
  render(<Markdown text={`参考 ${reference} 和 [note:笔记一]。`} />);
  const judgment = screen.getByRole('link', { name: '判断 · 第1版' });
  expect(judgment.getAttribute('href')).toBe(`#/memory/judgments/${id}`);
  expect(judgment.getAttribute('title')).toBe(reference);
  const note = screen.getByRole('link', { name: '笔记' });
  expect(note.getAttribute('href')).toBe(`#/notes/${encodeURIComponent('笔记一')}`);
  expect(note.getAttribute('title')).toBe('[note:笔记一]');
});

it('代码里的对象文本保持代码，流式未闭合标记保留原文', () => {
  const { container } = render(<Markdown text={'`[任务:x@1]`\n\n尚未结束的 **文字'} />);
  expect(container.querySelector('code')?.textContent).toBe('[任务:x@1]');
  expect(screen.queryByRole('link')).toBeNull();
  expect(container.textContent).toContain('尚未结束的 **文字');
});

it('Plasticine 写的本实例或旧 IP 的 #/ 链接换成站内地址、不新开窗口；站外和没有 #/ 的照旧', () => {
  const here = window.location.origin;
  render(<Markdown text={'[旧的](https://203.0.113.10/#/books/space/s-1) '
    + `[这台](${here}/#/notes) [站外](https://example.com/#/x) [根](https://203.0.113.10/)`} />);
  const old = screen.getByRole('link', { name: '旧的' });
  expect(old.getAttribute('href')).toBe('#/books/space/s-1');
  expect(old.getAttribute('target')).toBeNull();
  expect(screen.getByRole('link', { name: '这台' }).getAttribute('href')).toBe('#/notes');
  const outside = screen.getByRole('link', { name: '站外' });
  expect(outside.getAttribute('href')).toBe('https://example.com/#/x');
  expect(outside.getAttribute('target')).toBe('_blank');
  expect(screen.getByRole('link', { name: '根' }).getAttribute('href')).toBe('https://203.0.113.10/');
});
