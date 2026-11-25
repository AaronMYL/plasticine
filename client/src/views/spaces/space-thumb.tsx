import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useApi } from '../../api/context.tsx';
import type { SpaceView } from '../../api/shared.ts';
import { legacyPreviewHtml } from './space-document.ts';
import { SpaceFrame } from './space-frame.tsx';
import './space-thumb.css';
import { bodyDate } from '../../shell/time-text.ts';

export const THUMB_WIDTH = 1200;
export const THUMB_HEIGHT = 750;
const CACHE_MAX = 60;
const PRELOAD_MARGIN = '200px';

const cache = new Map<string, Promise<SpaceView>>();

function remember(key: string, read: () => Promise<SpaceView>): Promise<SpaceView> {
  let found = cache.get(key);
  if (found === undefined) {
    found = read();
    found.catch(() => cache.delete(key));
    cache.set(key, found);
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return found;
}

function useVisible(target: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (element === null || visible) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: PRELOAD_MARGIN });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, visible]);
  return visible;
}

function useScale(target: RefObject<HTMLElement | null>): number {
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const element = target.current;
    if (element === null) return undefined;
    const measure = (): void => setScale(element.clientWidth / THUMB_WIDTH);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return scale;
}

export interface SpaceThumbProps {
  spaceId: string;
  version?: number;
  className?: string;
}

export function SpaceThumb({ spaceId, version, className = '' }: SpaceThumbProps): ReactNode {
  const api = useApi();
  const box = useRef<HTMLDivElement>(null);
  const visible = useVisible(box);
  const scale = useScale(box);
  const [space, setSpace] = useState<SpaceView | null>(null);
  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    remember(`${spaceId}@${version ?? 'latest'}`, () => api.spaces.get(spaceId)).then((view) => {
      if (alive) setSpace(view);
    }, (cause: unknown) => console.warn('缩略图没读到这一页', cause));
    return () => {
      alive = false;
    };
  }, [api, spaceId, version, visible]);
  const genre = space?.genre ?? 'report';
  return (
    <div ref={box} className={`space-thumb ${className}`.trim()} data-genre={space?.genre ?? 'legacy'}
      aria-hidden="true">
      {space === null || scale === 0 ? null : (
        <div className="space-thumb-page" style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT,
          transform: `scale(${scale})` }}>
          <SpaceFrame mode="thumb" label={space.title} className="space-thumb-frame" space={{ genre,
            html: space.html ?? legacyPreviewHtml(space.doc, space.title), title: space.title,
            dateLabel: bodyDate(space.createdAt) }} />
        </div>
      )}
    </div>
  );
}
