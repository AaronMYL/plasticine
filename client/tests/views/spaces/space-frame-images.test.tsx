// 报告、来信、读书笔记里的图（11-14 界面统一，设计稿「图片：显示和打开」）：iframe 里点图（不在链接里）把这一页的图
// 交给外面，外面开同一个看图层，从点的那一张开；不是图片的地址不收。改字时不开。

import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { ImageViewerHost } from '../../../src/primitives/image-viewer/index.tsx';
import { SpaceFrame } from '../../../src/views/spaces/space-frame.tsx';
import { spaceRuntime } from '../../../src/views/spaces/space-runtime.ts';

const DOT = 'data:image/png;base64,iVBORw0KGgo=';

afterEach(() => { vi.restoreAllMocks(); });

it('iframe 说点了第二张：外面开看图层，从第 2 张开；不是图片的地址不收', () => {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  render(<ApiProvider api={fake.api}>
    <SpaceFrame label="周报" mode="page"
      space={{ title: '周报', genre: 'report', dateLabel: '', html: '<p>有图</p>' }} />
    <ImageViewerHost />
  </ApiProvider>);
  const frame = document.querySelector('iframe')!;
  const images = [{ asset: '', data: DOT, alt: '甲' }, { asset: '', data: 'javascript:alert(1)', alt: '坏的' },
    { asset: '', data: DOT, alt: '乙' }];
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
      data: { pz: 'space', type: 'image', images, index: 2 } }));
  });
  const viewer = screen.getByRole('dialog', { name: '看图' });
  expect(viewer.textContent).toContain('2 / 2');
  expect(screen.getAllByRole('img', { name: '乙' }).length).toBeGreaterThan(0);
});

it('页里的运行时：点不在链接里的图，把这一页的图和第几张交出去；链接里的图照旧是链接', () => {
  const page = document.createElement('div');
  page.innerHTML = `<p><img alt="甲" src="${DOT}"><a href="https://example.org"><img alt="链接里的"></a>`
    + `<img alt="乙" data-pz-asset="space-assets/b.png"></p>`;
  document.body.append(page);
  const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  spaceRuntime('page');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  post.mockClear();
  page.querySelector<HTMLImageElement>('img[alt="乙"]')!.click();
  expect(post).toHaveBeenCalledWith({ pz: 'space', type: 'image', index: 1, images: [
    { asset: '', alt: '甲', data: DOT }, { asset: 'space-assets/b.png', alt: '乙', data: '' },
  ] }, '*');
  page.remove();
});
