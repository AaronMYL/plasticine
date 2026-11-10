import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AttachmentGallery } from '../../../src/views/conversation/attachment-gallery.tsx';

const images = Array.from({ length: 4 }, (_, index) => ({ id: `image-${index}`, name: `草图${index + 1}.png`,
  mimeType: 'image/png', bytes: 2048, url: `https://example.test/image-${index}.png` }));

describe('消息附件画廊', () => {
  it.each([1, 2, 3, 4])('%i 张图片都显示为可打开的预览', (count) => {
    render(<AttachmentGallery items={images.slice(0, count)} />);
    expect(screen.getAllByRole('button', { name: /^查看图片/ })).toHaveLength(count);
    expect(screen.getAllByRole('img')).toHaveLength(count);
  });

  it('大图左右切换，Esc 关闭', () => {
    render(<AttachmentGallery items={images} />);
    fireEvent.click(screen.getByRole('button', { name: '查看图片 草图1.png' }));
    const dialog = screen.getByRole('dialog', { name: '附件预览' });
    expect(within(dialog).getByRole('img', { name: '草图1.png' })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(within(dialog).getByRole('img', { name: '草图2.png' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '上一张' }));
    expect(within(dialog).getByRole('img', { name: '草图1.png' })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('手机下滑关闭大图，文件显示名字、类型和大小', () => {
    render(<AttachmentGallery items={[...images, { id: 'text', name: '说明.txt', mimeType: 'text/plain',
      bytes: 2048, url: 'https://example.test/notes.txt' }]} />);
    expect(screen.getByRole('button', { name: '预览文件 说明.txt' }).textContent).toContain('TXT');
    expect(screen.getByRole('button', { name: '预览文件 说明.txt' }).textContent).toContain('2.0 KiB');
    fireEvent.click(screen.getByRole('button', { name: '查看图片 草图1.png' }));
    const image = within(screen.getByRole('dialog')).getByRole('img', { name: '草图1.png' });
    fireEvent.touchStart(image, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(image, { changedTouches: [{ clientX: 104, clientY: 220 }] });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('缩略图用于聊天网格，原件用于大图；大图失败可以原址重试', () => {
  render(<AttachmentGallery items={[{ ...images[0]!, thumbnailUrl: 'https://example.test/thumb.png' }]} />);
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.test/thumb.png');
  fireEvent.click(screen.getByRole('button', { name: '查看图片 草图1.png' }));
  const dialog = within(screen.getByRole('dialog'));
  const original = dialog.getByRole('img');
  expect(original.getAttribute('src')).toBe(images[0]!.url);
  fireEvent.error(original);
  expect(dialog.getByText('图片未能读取。')).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: '重试读取' }));
  expect(dialog.getByRole('img').getAttribute('src')).toBe(images[0]!.url);
});

it('二进制文件不渲染成乱码，保留下载入口', () => {
  render(<AttachmentGallery items={[{ id: 'archive-file', name: '资料.zip', mimeType: 'application/zip',
    bytes: 200, url: 'https://example.test/archive.zip' }]} />);
  fireEvent.click(screen.getByRole('button', { name: '预览文件 资料.zip' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('这类文件可以下载后打开。')).toBeTruthy();
  expect(dialog.getByRole('link', { name: '下载' }).getAttribute('download')).toBe('资料.zip');
});
