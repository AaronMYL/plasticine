import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CHAT_IMAGE_BOX, ImageGrid, type GridImage } from '../../src/primitives/image-grid/index.tsx';
import { ImageViewerHost } from '../../src/primitives/image-viewer/index.tsx';
import { ImageGallery } from '../../src/primitives/message/widgets/basic-widgets.tsx';

function pictures(count: number): GridImage[] {
  return Array.from({ length: count }, (_, index) => ({ src: `/p${index + 1}.png`, alt: `第${index + 1}张` }));
}

function Grid({ images }: { images: GridImage[] }) {
  return <><ImageGrid box={CHAT_IMAGE_BOX} images={images} /><ImageViewerHost /></>;
}

describe('image viewer', () => {
  it('5 images show 4 tiles with +1; clicking 4th opens at 4, arrow nav, Esc restores focus', () => {
    render(<Grid images={pictures(5)} />);
    const cells = screen.getAllByRole('button', { name: /^查看图片/ });
    expect(cells).toHaveLength(4);
    expect(cells[3]!.textContent).toContain('+1');
    cells[3]!.focus();
    fireEvent.click(cells[3]!);
    const viewer = screen.getByRole('dialog', { name: '看图' });
    expect(viewer.textContent).toContain('4 / 5');
    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    expect(viewer.textContent).toContain('5 / 5');
    expect(within(viewer).getByRole('img', { name: '第5张' })).toBeTruthy();
    fireEvent.keyDown(viewer, { key: 'ArrowLeft' });
    fireEvent.keyDown(viewer, { key: 'ArrowLeft' });
    expect(viewer.textContent).toContain('3 / 5');
    fireEvent.keyDown(viewer, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '看图' })).toBeNull();
    expect(document.activeElement).toBe(cells[3]);
  });

  it('single image hides index counter and pagination controls', () => {
    render(<Grid images={pictures(1)} />);
    fireEvent.click(screen.getByRole('button', { name: '查看图片 第1张' }));
    const viewer = screen.getByRole('dialog', { name: '看图' });
    expect(viewer.textContent).not.toContain('1 / 1');
    expect(within(viewer).queryByRole('button', { name: '下一张' })).toBeNull();
  });

  it('failed image shows fallback text and retries loading on click', () => {
    render(<Grid images={pictures(2)} />);
    const first = screen.getAllByRole('img')[0]!;
    fireEvent.error(first);
    const retry = screen.getByRole('button', { name: /图片没读到/ });
    fireEvent.click(retry);
    expect(screen.queryByRole('button', { name: /图片没读到/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^查看图片/ })).toHaveLength(2);
  });

  it('message image widget shares grid, shows caption in lightbox and below single image', () => {
    const { unmount } = render(<><ImageGallery images={[
      { kind: 'image', id: 'w1', src: '/a.png', alt: '甲', caption: '第一张的说明' },
      { kind: 'image', id: 'w2', src: '/b.png', alt: '乙', width: 400, height: 300 },
    ]} /><ImageViewerHost /></>);
    fireEvent.click(screen.getByRole('button', { name: '查看图片 甲' }));
    const viewer = screen.getByRole('dialog', { name: '看图' });
    expect(viewer.textContent).toContain('1 / 2');
    expect(viewer.textContent).toContain('第一张的说明');
    fireEvent.keyDown(viewer, { key: 'Escape' });
    unmount();
    render(<ImageGallery images={[{ kind: 'image', id: 'w3', src: '/c.png', alt: '丙', caption: '只有一张' }]} />);
    expect(screen.getByText('只有一张').tagName).toBe('FIGCAPTION');
  });
});
