// 中文标点后紧跟中文的强调记号（走查 11-07）：照 marked-cjk-friendly 的规则认成加粗、斜体、删除线，不再原样露出星号。

import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Markdown } from '../../src/primitives/message/markdown.tsx';

it('句号后紧跟中文的加粗照样加粗，不露星号', () => {
  const text = '**这项定时任务还没建成，也没有发出任何消息。**目前只能在对话里提醒你。';
  const { container } = render(<Markdown text={text} />);
  expect(container.querySelector('strong')?.textContent).toBe('这项定时任务还没建成，也没有发出任何消息。');
  expect(container.textContent).not.toContain('*');
});

it('斜体和删除线在中文标点旁也认得出', () => {
  const { container } = render(<Markdown text={'*先别动。*等我回来。~~已经取消。~~改成明天。'} />);
  expect(container.querySelector('em')?.textContent).toBe('先别动。');
  expect(container.querySelector('del')?.textContent).toBe('已经取消。');
  expect(container.textContent).not.toMatch(/[*~]/);
});

it('英文里的强调照旧，单词中间的下划线不当成斜体', () => {
  const { container } = render(<Markdown text={'**bold** and snake_case_name'} />);
  expect(container.querySelector('strong')?.textContent).toBe('bold');
  expect(container.querySelector('em')).toBeNull();
  expect(container.textContent).toContain('snake_case_name');
});
