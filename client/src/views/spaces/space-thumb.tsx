// 空间的缩略图（第 8 批第 6 条，设计稿 Library-Spaces / Chat-Letter：「在客户端用同一份 html 按 1200 宽渲染再缩小，
// 滚到可见才渲染，不在服务器截图」）。滚进视口才去读那一页、才放 iframe；读过的按「空间 @ 版本」记着，列表来回滚
// 不重读。还没重写成网页的旧版式拼一页报告的开头当缩略图（legacyPreviewHtml）。

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useApi } from '../../api/context.tsx';
import type { SpaceView } from '../../api/shared.ts';
import { legacyPreviewHtml } from './space-document.ts';
import { SpaceFrame } from './space-frame.tsx';
import { letterDate } from './space-time.ts';
import './space-thumb.css';

/** 缩略图里的页面按这么宽排版（设计稿 1200 × 750，再整体缩小）。 */
export const THUMB_WIDTH = 1200;
export const THUMB_HEIGHT = 750;
// 记住最近读过的这么多页（一屏缩略图加上来回滚的余量）。
const CACHE_MAX = 60;
// 离视口还有这么远就开始读，滚到时已经画好。
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

/** 容器多宽，页面就缩成多小。 */
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
  /** 列表里给的版本：版本变了重读。 */
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
            dateLabel: letterDate(space.createdAt) }} />
        </div>
      )}
    </div>
  );
}
