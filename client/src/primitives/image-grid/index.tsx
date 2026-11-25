import { useState, type CSSProperties, type ReactNode } from 'react';
import { showImages, type ViewerImage } from '../image-viewer/index.tsx';
import './styles.css';

export interface GridImage extends ViewerImage {
  ratio?: number | null | undefined;
  thumb?: string | undefined;
}

export const FEED_IMAGE_BOX = { width: 720, height: 480 } as const;
export const CHAT_IMAGE_BOX = { width: 320, height: 400 } as const;

const SHOWN = 4;

function Picture({ image, cover, onFail }: { image: GridImage; cover: boolean; onFail: () => void }): ReactNode {
  return <img src={image.thumb ?? image.src} alt={image.alt ?? ''} loading="lazy" decoding="async" draggable={false}
    referrerPolicy="no-referrer" data-cover={cover} onError={onFail} />;
}

function Cell({ image, index, total, more, cover, style, onOpen }: { image: GridImage; index: number; total: number;
  more: number; cover: boolean; style?: CSSProperties; onOpen: () => void }): ReactNode {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const label = image.alt !== undefined && image.alt !== '' ? `查看图片 ${image.alt}`
    : total > 1 ? `查看图片（第 ${index + 1} 张，共 ${total} 张）` : '查看图片';
  if (failed) {
    return <button type="button" className="image-cell image-cell-failed" style={style} onClick={() => {
      setFailed(false);
      setAttempt(attempt + 1);
    }}>图片没读到 · 重试</button>;
  }
  return (
    <button type="button" className="image-cell" style={style} aria-label={label} onClick={onOpen}>
      <Picture key={attempt} image={image} cover={cover} onFail={() => setFailed(true)} />
      {more > 0 ? <span className="image-cell-more" aria-hidden="true">+{more}</span> : null}
    </button>
  );
}

export function ImageGrid({ images, box, label }: { images: readonly GridImage[];
  box: { width: number; height: number }; label?: string }): ReactNode {
  if (images.length === 0) return null;
  const open = (index: number): void => showImages(images, index);
  const first = images[0]!;
  if (images.length === 1) {
    const ratio = first.ratio ?? null;
    const style: CSSProperties = ratio === null || ratio <= 0
      ? { maxWidth: `min(100%, ${box.width}px)`, maxHeight: box.height }
      : { width: `min(100%, ${box.width}px, ${Math.round(box.height / ratio)}px)`, aspectRatio: `1 / ${ratio}` };
    return <div className="image-grid image-grid-one" aria-label={label}
      role={label === undefined ? undefined : 'group'}>
      <Cell image={first} index={0} total={1} more={0} cover={false} style={style} onOpen={() => open(0)} />
    </div>;
  }
  const shown = images.slice(0, SHOWN);
  return (
    <div className="image-grid" data-count={Math.min(images.length, SHOWN)} style={{ maxWidth: box.width }}
      role={label === undefined ? undefined : 'group'} aria-label={label}>
      {shown.map((image, index) => (
        <Cell key={`${image.src}:${index}`} image={image} index={index} total={images.length}
          more={index === SHOWN - 1 ? images.length - SHOWN : 0} cover onOpen={() => open(index)} />
      ))}
    </div>
  );
}
