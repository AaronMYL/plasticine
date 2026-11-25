import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import './styles.css';

export interface ViewerImage {
  src: string;
  alt?: string | undefined;
  caption?: string | undefined;
  original?: string | null | undefined;
  download?: { url: string; name: string } | null | undefined;
}

interface Shown {
  images: readonly ViewerImage[];
  index: number;
}

export const imageViewerStore = new Store<Shown | null>(null);

export function showImages(images: readonly ViewerImage[], index = 0): void {
  if (images.length === 0) return;
  imageViewerStore.set({ images, index: Math.min(Math.max(0, index), images.length - 1) });
}

const MAX_SCALE = 5;
const DOUBLE_SCALE = 2.5;
const SWIPE_PX = 64;

interface View {
  scale: number;
  x: number;
  y: number;
}

const FLAT: View = { scale: 1, x: 0, y: 0 };

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(1, value));
}

function zoomAt(view: View, next: number, px: number, py: number): View {
  const scale = clampScale(next);
  if (scale === 1) return FLAT;
  const ratio = scale / view.scale;
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

function Stage({ image, onFlip, onClose }: { image: ViewerImage; onFlip: (step: -1 | 1) => void;
  onClose: () => void }): ReactNode {
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FLAT);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; view: View; pinch: number | null } | null>(null);
  const center = (clientX: number, clientY: number): { x: number; y: number } => {
    const box = stage.current?.getBoundingClientRect();
    return box === undefined ? { x: 0, y: 0 }
      : { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
  };
  const wheel = (event: WheelEvent<HTMLDivElement>): void => {
    const at = center(event.clientX, event.clientY);
    setView((current) => zoomAt(current, current.scale * Math.exp(-event.deltaY * 0.0015), at.x, at.y));
  };
  const down = (event: PointerEvent<HTMLDivElement>): void => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const points = [...pointers.current.values()];
    const pinch = points.length === 2
      ? Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) : null;
    gesture.current = { startX: event.clientX, startY: event.clientY, view, pinch };
  };
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(event.pointerId) || gesture.current === null) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = gesture.current;
    const points = [...pointers.current.values()];
    if (points.length === 2 && start.pinch !== null) {
      const distance = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
      const mid = center((points[0]!.x + points[1]!.x) / 2, (points[0]!.y + points[1]!.y) / 2);
      setView(zoomAt(start.view, start.view.scale * (distance / start.pinch), mid.x, mid.y));
      return;
    }
    if (start.view.scale > 1) {
      setView({ ...start.view, x: start.view.x + event.clientX - start.startX,
        y: start.view.y + event.clientY - start.startY });
    }
  };
  const up = (event: PointerEvent<HTMLDivElement>): void => {
    const start = gesture.current;
    const single = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    if (start === null || !single || start.view.scale > 1 || event.pointerType === 'mouse') return;
    const dx = event.clientX - start.startX;
    const dy = event.clientY - start.startY;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) onFlip(dx < 0 ? 1 : -1);
    else if (dy > SWIPE_PX && Math.abs(dy) > Math.abs(dx)) onClose();
  };
  return (
    <div ref={stage} className="image-viewer-stage" data-zoomed={view.scale > 1} onWheel={wheel}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={(event) => {
        const at = center(event.clientX, event.clientY);
        setView(view.scale > 1 ? FLAT : zoomAt(view, DOUBLE_SCALE, at.x, at.y));
      }}>
      {failed ? (
        <div className="image-viewer-failed" role="alert">
          <p>图片没读到</p>
          <button type="button" className="secondary-button" onClick={() => {
            setFailed(false);
            setAttempt(attempt + 1);
          }}>重试</button>
        </div>
      ) : (
        <img key={attempt} className="image-viewer-image" src={image.src} alt={image.alt ?? ''} draggable={false}
          referrerPolicy="no-referrer" onError={() => setFailed(true)}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
      )}
    </div>
  );
}

function ImageViewer({ shown, onClose }: { shown: Shown; onClose: () => void }): ReactNode {
  const phone = useViewportWidth() < PHONE_BELOW;
  const [index, setIndex] = useState(shown.index);
  const box = useRef<HTMLDivElement>(null);
  const count = shown.images.length;
  const image = shown.images[index];
  const flip = (step: -1 | 1): void => setIndex((current) => Math.min(count - 1, Math.max(0, current + step)));
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);
  if (image === undefined) return null;
  const counter = count > 1 ? <span className="image-viewer-count mono">{index + 1} / {count}</span> : null;
  return createPortal(
    <div ref={box} className="image-viewer" role="dialog" aria-modal="true" aria-label="看图" tabIndex={-1}
      data-phone={phone} onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          flip(-1);
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          flip(1);
        }
      }}>
      <header className="image-viewer-bar">
        {phone ? <IconButton icon="close" label="关掉" size={20} onClick={onClose} /> : null}
        {counter}
        {image.caption === undefined || phone ? null : <span className="image-viewer-caption">{image.caption}</span>}
        <span className="image-viewer-gap" />
        {image.original == null ? null : (
          <a className="icon-button" href={image.original} target="_blank" rel="noopener noreferrer"
            aria-label="打开原文" data-tip="打开原文"><Icon name="external" /></a>
        )}
        {image.download == null ? null : (
          <a className="icon-button" href={image.download.url} download={image.download.name} aria-label="下载"
            data-tip="下载"><Icon name="download" /></a>
        )}
        {phone ? null : <IconButton icon="close" label="关掉" onClick={onClose} />}
      </header>
      <Stage key={index} image={image} onFlip={flip} onClose={onClose} />
      {count < 2 || phone ? null : <>
        <IconButton icon="back" label="上一张" className="image-viewer-arrow" data-side="left" disabled={index === 0}
          onClick={() => flip(-1)} />
        <IconButton icon="chevron-right" label="下一张" className="image-viewer-arrow" data-side="right"
          disabled={index === count - 1} onClick={() => flip(1)} />
      </>}
    </div>,
    document.body,
  );
}

export function ImageViewerHost(): ReactNode {
  const shown = useStore(imageViewerStore);
  if (shown === null) return null;
  return <ImageViewer key={`${shown.images[0]?.src ?? ''}:${shown.index}`} shown={shown}
    onClose={() => imageViewerStore.set(null)} />;
}
