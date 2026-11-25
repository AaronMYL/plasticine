import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Markdown } from '../../src/primitives/message/markdown.tsx';

it('bold text immediately after Chinese period renders bold without raw asterisks', () => {
  const text = '**这项定时任务还没建成，也没有发出任何消息。**目前只能在对话里提醒你。';
  const { container } = render(<Markdown text={text} />);
  expect(container.querySelector('strong')?.textContent).toBe('这项定时任务还没建成，也没有发出任何消息。');
  expect(container.textContent).not.toContain('*');
});

it('italic and strikethrough render next to Chinese punctuation', () => {
  const { container } = render(<Markdown text={'*先别动。*等我回来。~~已经取消。~~改成明天。'} />);
  expect(container.querySelector('em')?.textContent).toBe('先别动。');
  expect(container.querySelector('del')?.textContent).toBe('已经取消。');
  expect(container.textContent).not.toMatch(/[*~]/);
});

it('English emphasis works normally and intraword underscores are not italicized', () => {
  const { container } = render(<Markdown text={'**bold** and snake_case_name'} />);
  expect(container.querySelector('strong')?.textContent).toBe('bold');
  expect(container.querySelector('em')).toBeNull();
  expect(container.textContent).toContain('snake_case_name');
});
