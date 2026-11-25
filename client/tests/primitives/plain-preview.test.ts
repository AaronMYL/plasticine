import { expect, it } from 'vitest';
import { plainPreview } from '../../src/primitives/message/plain-preview.ts';

it('strips emphasis markers including next to Chinese punctuation', () => {
  expect(plainPreview('**这项定时任务还没建成，也没有发出任何消息。**目前只能提醒你。'))
    .toBe('这项定时任务还没建成，也没有发出任何消息。目前只能提醒你。');
  expect(plainPreview('_先别动_ 和 ~~取消了~~ 和 `npm ci`')).toBe('先别动 和 取消了 和 npm ci');
});

it('strips headings, blockquotes, list markers, and joins paragraphs into one line', () => {
  expect(plainPreview('## 结论\n\n> 引一句\n\n- 第一\n- 第二\n\n1. 再一条')).toBe('结论 引一句 第一 第二 再一条');
});

it('keeps link text, image alt text, and code block contents', () => {
  expect(plainPreview('看 [这篇](https://example.com/a) 和 ![截图](x.png)')).toBe('看 这篇 和 截图');
  expect(plainPreview('```sh\nls -la\n```')).toBe('ls -la');
});

it('plain text stays unchanged and empty string stays empty', () => {
  expect(plainPreview('只是一句话 2*3=6')).toBe('只是一句话 2*3=6');
  expect(plainPreview('')).toBe('');
});
