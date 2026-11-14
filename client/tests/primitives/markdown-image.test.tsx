// 回复里的图（11-14 图片统一，Aaron 弹框选）：直接显示（经服务端转一道），整张、点开是同一个看图层，顶上「打开原文」
// 是原图地址；不是 http(s) 的照旧是一行链接。

import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ApiProvider } from '../../src/api/context.tsx';
import type { PlasticineApi } from '../../src/api/client.ts';
import { Markdown } from '../../src/primitives/message/markdown.tsx';
import { ImageViewerHost } from '../../src/primitives/image-viewer/index.tsx';

const api = { links: { image: (url: string) => `/v2/image?url=${encodeURIComponent(url)}` } } as unknown as PlasticineApi;

it('回复里的图直接显示，经服务端转一道；点开看大图，「打开原文」是原图', () => {
  render(<ApiProvider api={api}><Markdown text={'这是走势：\n\n![十月的走势](https://charts.test/oct.png)'} />
    <ImageViewerHost /></ApiProvider>);
  const image = screen.getByRole('img', { name: '十月的走势' });
  expect(image.getAttribute('src')).toBe('/v2/image?url=https%3A%2F%2Fcharts.test%2Foct.png');
  fireEvent.click(screen.getByRole('button', { name: '查看图片 十月的走势' }));
  const viewer = screen.getByRole('dialog', { name: '看图' });
  expect(within(viewer).getByRole('link', { name: '打开原文' }).getAttribute('href')).toBe('https://charts.test/oct.png');
});

it('不是 http(s) 的图照旧是一行链接', () => {
  render(<Markdown text={'![本地](file:///tmp/a.png)'} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('link', { name: '本地' })).toBeTruthy();
});

it('应用外没有接口的地方不直连外站，照旧给链接', () => {
  render(<Markdown text={'![十月的走势](https://charts.test/oct.png)'} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('link', { name: '十月的走势' }).getAttribute('href')).toBe('https://charts.test/oct.png');
});
