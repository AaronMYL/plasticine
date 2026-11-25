import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { ImageViewerHost } from '../../../src/primitives/image-viewer/index.tsx';
import { SpaceFrame } from '../../../src/views/spaces/space-frame.tsx';
import { spaceRuntime } from '../../../src/views/spaces/space-runtime.ts';

const DOT = 'data:image/png;base64,iVBORw0KGgo=';

afterEach(() => { vi.restoreAllMocks(); });

it('iframe image click opens host lightbox at index 2 and rejects non-image URLs', () => {
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

it('in-page runtime emits gallery and index for non-linked images while keeping linked images', () => {
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
