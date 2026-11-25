import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Markdown } from '../../src/primitives/message/markdown.tsx';

it('reply preserves headings, nested lists, tables, code, links, and versioned object refs', () => {
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

it('English object ref shows Chinese name and version, full ID in tooltip, same route', () => {
  const id = '6d012f13-2bec-4972-bc59-2a13a23d5d27';
  const reference = `[judgment:${id}@1]`;
  render(<Markdown text={`参考 ${reference} 和 [note:笔记一]。`} />);
  const judgment = screen.getByRole('link', { name: '判断 · 第1版' });
  expect(judgment.getAttribute('href')).toBe(`#/memory/judgments/${id}`);
  expect(judgment.getAttribute('data-tip')).toBe(reference);
  const note = screen.getByRole('link', { name: '笔记' });
  expect(note.getAttribute('href')).toBe(`#/notes/${encodeURIComponent('笔记一')}`);
  expect(note.getAttribute('data-tip')).toBe('[note:笔记一]');
});

it('object text inside code stays code; unclosed streaming markers stay literal', () => {
  const { container } = render(<Markdown text={'`[任务:x@1]`\n\n尚未结束的 **文字'} />);
  expect(container.querySelector('code')?.textContent).toBe('[任务:x@1]');
  expect(screen.queryByRole('link')).toBeNull();
  expect(container.textContent).toContain('尚未结束的 **文字');
});

it('rewrites same-instance or legacy-IP #/ links to in-app links; external links unchanged', () => {
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
