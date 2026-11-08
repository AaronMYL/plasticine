// 裁剪头像（2026-11-05 设计稿 Avatar）：挑了一张图以后弹出的小框。图可以拖、下面一条滑杆放大缩小，圆形（账号头像）
// 或圆角方形（群头像）的取景框外面压暗；「保存」把取景框里的那块画成 256×256 的小图（JPEG，压到 64k 字符以内，好随
// 资料加密发给好友），「取消」什么都不改。纯在本机算，图不上传原件。

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '../../shell/icons.tsx';
import './avatar-crop.css';

/** 取景区 320、取景框 240（设计稿）；保存成 256 的方图。 */
const VIEW = 320;
const FRAME = 240;
const OUTPUT = 256;
/** 放大到铺满取景框的 4 倍为止。 */
const ZOOM_MAX = 4;
/** data URL 不超过 64k 字符（shared/net-wire.ts AVATAR_MAX_CHARS）：质量从 0.9 往下试。 */
const AVATAR_MAX_CHARS = 64_000;
const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];

interface Size {
  width: number;
  height: number;
}

/** 图的左上角落在取景区哪里（偏移是图中心离取景区中心多远）。 */
function topLeft(size: Size, scale: number, offset: { x: number; y: number }): { left: number; top: number } {
  return { left: VIEW / 2 + offset.x - (size.width * scale) / 2, top: VIEW / 2 + offset.y - (size.height * scale) / 2 };
}

/** 取景框永远被图盖满：拖、缩放以后把偏移拉回来。 */
export function clampOffset(size: Size, scale: number, offset: { x: number; y: number }): { x: number; y: number } {
  const spareX = Math.max(0, (size.width * scale - FRAME) / 2);
  const spareY = Math.max(0, (size.height * scale - FRAME) / 2);
  return { x: Math.min(spareX, Math.max(-spareX, offset.x)), y: Math.min(spareY, Math.max(-spareY, offset.y)) };
}

export function coverScale(size: Size): number {
  return Math.max(FRAME / size.width, FRAME / size.height);
}

function render(image: HTMLImageElement, size: Size, scale: number, offset: { x: number; y: number }): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT;
  canvas.height = OUTPUT;
  const context = canvas.getContext('2d');
  if (context === null) {
    return null;
  }
  const { left, top } = topLeft(size, scale, offset);
  const source = FRAME / scale;
  context.drawImage(image, (VIEW / 2 - FRAME / 2 - left) / scale, (VIEW / 2 - FRAME / 2 - top) / scale, source,
    source, 0, 0, OUTPUT, OUTPUT);
  for (const quality of QUALITIES) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= AVATAR_MAX_CHARS) {
      return url;
    }
  }
  return null;
}

export interface AvatarCropProps {
  file: File;
  shape: 'circle' | 'square';
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
}

export function AvatarCrop({ file, shape, onCancel, onSave }: AvatarCropProps): ReactNode {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const base = size === null ? 1 : coverScale(size);
  const scale = base * (1 + (zoom / 100) * (ZOOM_MAX - 1));
  const shown = size === null ? offset : clampOffset(size, scale, offset);
  const place = size === null ? { left: 0, top: 0 } : topLeft(size, scale, shown);
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current === null || size === null) {
      return;
    }
    setOffset(clampOffset(size, scale, { x: drag.current.from.x + event.clientX - drag.current.x,
      y: drag.current.from.y + event.clientY - drag.current.y }));
  };
  const save = (): void => {
    if (image.current === null || size === null) {
      return;
    }
    const dataUrl = render(image.current, size, scale, shown);
    if (dataUrl === null) {
      setError('这张图压不到 64 KB 以内，换一张小一点的。');
      return;
    }
    onSave(dataUrl);
  };
  const hole = shape === 'circle'
    ? `M${VIEW / 2 - FRAME / 2},${VIEW / 2} a${FRAME / 2},${FRAME / 2} 0 1,0 ${FRAME},0 a${FRAME / 2},${FRAME / 2} 0 1,0 -${FRAME},0`
    : `M${(VIEW - FRAME) / 2},${(VIEW - FRAME) / 2} h${FRAME} v${FRAME} h-${FRAME} z`;
  return (
    <div className="avatar-crop-scrim" role="presentation" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    }}>
      <div className="avatar-crop" role="dialog" aria-modal="true" aria-label="裁剪头像">
        <h2 className="avatar-crop-title">裁剪头像</h2>
        <div className="avatar-crop-view" onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, from: shown };
        }} onPointerMove={move} onPointerUp={() => {
          drag.current = null;
        }}>
          {url === null ? null : (
            <img ref={image} src={url} alt="要裁的图" draggable={false} className="avatar-crop-image"
              style={size === null ? { visibility: 'hidden' } : { left: place.left, top: place.top,
                width: size.width * scale, height: size.height * scale }}
              onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight })}
              onError={() => setError('这张图打不开，换一张。')} />
          )}
          <svg className="avatar-crop-mask" viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true">
            <path fillRule="evenodd" d={`M0,0 H${VIEW} V${VIEW} H0 Z ${hole}`} />
            <path className="avatar-crop-ring" d={hole} />
          </svg>
        </div>
        <label className="avatar-crop-zoom">
          <Icon name="image" size={12} />
          <input type="range" min={0} max={100} value={zoom} aria-label="放大缩小"
            onChange={(event) => setZoom(Number(event.target.value))} />
          <Icon name="image" size={18} />
        </label>
        {error === null ? null : <p className="avatar-crop-error" role="alert">{error}</p>}
        <div className="avatar-crop-actions">
          <button type="button" className="text-button text-button-quiet" onClick={onCancel}>取消</button>
          <button type="button" className="primary-button" disabled={size === null} onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
