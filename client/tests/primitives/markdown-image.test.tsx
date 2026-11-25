import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ApiProvider } from '../../src/api/context.tsx';
import type { PlasticineApi } from '../../src/api/client.ts';
import { Markdown } from '../../src/primitives/message/markdown.tsx';
import { ImageViewerHost } from '../../src/primitives/image-viewer/index.tsx';

const api = { links: { image: (url: string) => `/v2/image?url=${encodeURIComponent(url)}` } } as unknown as
  PlasticineApi;

it('reply images proxy through server; lightbox Open Original links to source URL', () => {
  render(<ApiProvider api={api}><Markdown text={'这是走势：\n\n![十月的走势](https://charts.test/oct.png)'} />
    <ImageViewerHost /></ApiProvider>);
  const image = screen.getByRole('img', { name: '十月的走势' });
  expect(image.getAttribute('src')).toBe('/v2/image?url=https%3A%2F%2Fcharts.test%2Foct.png');
  fireEvent.click(screen.getByRole('button', { name: '查看图片 十月的走势' }));
  const viewer = screen.getByRole('dialog', { name: '看图' });
  expect(within(viewer).getByRole('link', { name: '打开原文' }).getAttribute('href')).toBe('https://charts.test/oct.png');
});

it('non-http(s) image stays a plain link', () => {
  render(<Markdown text={'![本地](file:///tmp/a.png)'} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('link', { name: '本地' })).toBeTruthy();
});

it('outside app without API, avoids direct external image fetch and renders link', () => {
  render(<Markdown text={'![十月的走势](https://charts.test/oct.png)'} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('link', { name: '十月的走势' }).getAttribute('href')).toBe('https://charts.test/oct.png');
});
