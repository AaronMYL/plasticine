// 消息附件（11-14 图片统一）：图和信息流同一套排法（整块最宽 320、一张最高 400），点开是全站同一个看图层
// （primitives/image-viewer）：← → 翻，Esc 关，手机往下滑关，顶上能下载；文件一行一个。

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageViewerHost } from '../../../src/primitives/image-viewer/index.tsx';
import { AttachmentGallery } from '../../../src/views/conversation/attachment-gallery.tsx';

const images = Array.from({ length: 4 }, (_, index) => ({ id: `image-${index}`, name: `草图${index + 1}.png`,
  mimeType: 'image/png', bytes: 2048, url: `https://example.test/image-${index}.png` }));

function Gallery({ items }: { items: Parameters<typeof AttachmentGallery>[0]['items'] }): ReturnType<typeof render> {
  return render(<><AttachmentGallery items={items} /><ImageViewerHost /></>);
}

describe('消息附件画廊', () => {
  it.each([1, 2, 3, 4])('%i 张图片都显示为可打开的预览', (count) => {
    Gallery({ items: images.slice(0, count) });
    expect(screen.getAllByRole('button', { name: /^查看图片/ })).toHaveLength(count);
    expect(screen.getAllByRole('img')).toHaveLength(count);
  });

  it('五张以上：第四格写「+n」，点哪张都从那张开始看', () => {
    const many = [...images, { ...images[0]!, id: 'image-5', name: '草图5.png', url: 'https://example.test/5.png' }];
    Gallery({ items: many });
    const cells = screen.getAllByRole('button', { name: /^查看图片/ });
    expect(cells).toHaveLength(4);
    expect(cells[3]!.textContent).toBe('+1');
    fireEvent.click(cells[3]!);
    const dialog = screen.getByRole('dialog', { name: '看图' });
    expect(within(dialog).getByRole('img', { name: '草图4.png' })).toBeTruthy();
    expect(dialog.textContent).toContain('4 / 5');
  });

  it('大图左右切换，Esc 关闭；顶上能下载', () => {
    Gallery({ items: images });
    fireEvent.click(screen.getByRole('button', { name: '查看图片 草图1.png' }));
    const dialog = screen.getByRole('dialog', { name: '看图' });
    expect(within(dialog).getByRole('img', { name: '草图1.png' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '下载' }).getAttribute('download')).toBe('草图1.png');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(within(dialog).getByRole('img', { name: '草图2.png' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '上一张' }));
    expect(within(dialog).getByRole('img', { name: '草图1.png' })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('手机往下滑关闭大图，左右滑翻页；文件显示名字、类型和大小', () => {
    Gallery({ items: [...images, { id: 'text', name: '说明.txt', mimeType: 'text/plain',
      bytes: 2048, url: 'https://example.test/notes.txt' }] });
    expect(screen.getByRole('button', { name: '预览文件 说明.txt' }).textContent).toContain('TXT');
    expect(screen.getByRole('button', { name: '预览文件 说明.txt' }).textContent).toContain('2.0 KiB');
    fireEvent.click(screen.getByRole('button', { name: '查看图片 草图1.png' }));
    // 翻页后舞台换了一块（每张一块），每次滑都重新找。
    const swipe = (dx: number, dy: number): void => {
      const stage = screen.getByRole('dialog').querySelector('.image-viewer-stage')!;
      fireEvent.pointerDown(stage, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
      fireEvent.pointerUp(stage, { pointerId: 1, pointerType: 'touch', clientX: 100 + dx, clientY: 100 + dy });
    };
    swipe(-120, 4);
    expect(within(screen.getByRole('dialog')).getByRole('img', { name: '草图2.png' })).toBeTruthy();
    swipe(4, 120);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('缩略图用于聊天网格，原件用于大图；大图读不出来可以重试', () => {
  Gallery({ items: [{ ...images[0]!, thumbnailUrl: 'https://example.test/thumb.png' }] });
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.test/thumb.png');
  fireEvent.click(screen.getByRole('button', { name: '查看图片 草图1.png' }));
  const dialog = within(screen.getByRole('dialog'));
  const original = dialog.getByRole('img', { name: '草图1.png' });
  expect(original.getAttribute('src')).toBe(images[0]!.url);
  fireEvent.error(original);
  expect(dialog.getByText('图片读不出来')).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: '重试' }));
  expect(dialog.getByRole('img', { name: '草图1.png' }).getAttribute('src')).toBe(images[0]!.url);
});

it('看不了的文件（压缩包）不开预览：后缀 + 名字 + 大小，点了直接下载（第13批）', () => {
  Gallery({ items: [{ id: 'archive-file', name: '资料.zip', mimeType: 'application/zip',
    bytes: 200, url: 'https://example.test/archive.zip' }] });
  const link = screen.getByRole('link', { name: '下载 资料.zip' });
  expect(link.getAttribute('download')).toBe('资料.zip');
  expect(link.getAttribute('href')).toBe('https://example.test/archive.zip');
  expect(link.querySelector('.file-ext')?.textContent).toBe('ZIP');
  expect(link.textContent).toContain('资料.zip');
  expect(screen.queryByRole('button', { name: /预览文件/ })).toBeNull();
});
