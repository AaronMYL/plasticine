// 一行预览（消息列表、首页、通知）只留文字：加粗、斜体、删除线、代码、标题、引用、列表符号、链接网址都去掉。

import { expect, it } from 'vitest';
import { plainPreview } from '../../src/primitives/message/plain-preview.ts';

it('去掉强调记号，中文标点旁的也去掉', () => {
  expect(plainPreview('**这项定时任务还没建成，也没有发出任何消息。**目前只能提醒你。'))
    .toBe('这项定时任务还没建成，也没有发出任何消息。目前只能提醒你。');
  expect(plainPreview('_先别动_ 和 ~~取消了~~ 和 `npm ci`')).toBe('先别动 和 取消了 和 npm ci');
});

it('标题、引用、列表符号去掉，几段并成一行', () => {
  expect(plainPreview('## 结论\n\n> 引一句\n\n- 第一\n- 第二\n\n1. 再一条')).toBe('结论 引一句 第一 第二 再一条');
});

it('链接只留文字，图片留说明，代码块留代码', () => {
  expect(plainPreview('看 [这篇](https://example.com/a) 和 ![截图](x.png)')).toBe('看 这篇 和 截图');
  expect(plainPreview('```sh\nls -la\n```')).toBe('ls -la');
});

it('普通文字原样，空的是空', () => {
  expect(plainPreview('只是一句话 2*3=6')).toBe('只是一句话 2*3=6');
  expect(plainPreview('')).toBe('');
});
