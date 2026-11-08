// 网页缩放按网站记住（2026-11-04 第 2 批 ⋯ 菜单「缩放 − 100% +（按网站记住）」）：同一个网站（主机名）记一档，
// 下次打开、换到这个网站时原生网页照这一档缩放。100% 不记。存一份在 localStorage，换台设备不跟着走。

import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { WEB_ZOOM_MAX, WEB_ZOOM_MIN } from '../api/shared.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

export const ZOOM_STORAGE_KEY = 'plasticine:web-zoom';

/** 缩放的档位：和 Safari、Chrome 一样一档一档走，不是连续的。 */
export const ZOOM_STEPS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** 最多记这么多个网站：再多就是常年累积的零碎，先忘最早记的。 */
const SITES_MAX = 200;

const StoredZoomSchema = Type.Record(Type.String(), Type.Number({ minimum: WEB_ZOOM_MIN, maximum: WEB_ZOOM_MAX }));

/** 往大（1）或往小（-1）走一档；已经到头就停在头上。 */
export function zoomStep(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_STEPS.find((step) => step > current + 0.001) ?? ZOOM_STEPS.at(-1)!;
  }
  return [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? ZOOM_STEPS[0]!;
}

/** 网址的网站（主机名，去掉 www.）；不是网址就是 null。 */
export function siteOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.host.replace(/^www\./, '') : null;
  } catch (cause) {
    console.warn('网址解析不了，这一页不按网站记缩放', cause);
    return null;
  }
}

function read(storage: KeyValueStorage | null): Record<string, number> {
  try {
    const raw = storage?.getItem(ZOOM_STORAGE_KEY) ?? null;
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return Value.Check(StoredZoomSchema, parsed) ? parsed : {};
  } catch (cause) {
    console.warn('记着的网页缩放没能读出来，都按 100%', cause);
    return {};
  }
}

export class SiteZoom {
  readonly store: Store<Readonly<Record<string, number>>>;
  private readonly storage: KeyValueStorage | null;

  constructor(storage: KeyValueStorage | null) {
    this.storage = storage;
    this.store = new Store(read(storage));
  }

  /** 这个网址所在网站记着的缩放；没记过是 1。 */
  of(url: string): number {
    const site = siteOf(url);
    return site === null ? 1 : this.store.get()[site] ?? 1;
  }

  /** 记下这个网站的缩放（1 就是忘掉）。 */
  set(url: string, factor: number): void {
    const site = siteOf(url);
    if (site === null) {
      return;
    }
    const clamped = Math.min(WEB_ZOOM_MAX, Math.max(WEB_ZOOM_MIN, factor));
    this.store.set((previous) => {
      const rest = Object.entries(previous).filter(([key]) => key !== site);
      const next = clamped === 1 ? rest : [...rest, [site, clamped] as [string, number]];
      return Object.fromEntries(next.slice(-SITES_MAX));
    });
    try {
      this.storage?.setItem(ZOOM_STORAGE_KEY, JSON.stringify(this.store.get()));
    } catch (cause) {
      console.warn('网页缩放没能记下，这次照样缩放', cause);
    }
  }
}
