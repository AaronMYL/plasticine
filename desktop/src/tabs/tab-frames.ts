// 网页标签里跨源的内嵌框（11-16）：主页面的注入脚本带 frames: 'inline' 读进同源的框，跨源的（别家的评论区、嵌着的
// 表单和编辑器）读不进去，只报个数。这里在那几个框各自的 preload 里跑同一段脚本，编号接在主页面后面（base），大纲
// 里一段一段接上「〔内嵌框：网站〕」。合起来的那一版记下每一段从哪号到哪号、是哪个框、那个框自己的哪一版；按编号
// 做时找回是哪个框、框里第几号。没有跨源框时原样就是主页面那一版。

import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import { PAGE_ELEMENTS_MAX, PAGE_OUTLINE_MAX_CHARS, PagePerceptionSchema }
  from '../../../agent/shared/api/page-operate.ts';
import type { FrameRef } from './tab-views.ts';

/** 一页最多再读这么多个跨源内嵌框。 */
const FRAMES_MAX = 10;
/** 太小的框（统计、广告的 1×1）不读。 */
const FRAME_MIN_WIDTH = 40;
const FRAME_MIN_HEIGHT = 20;
/** 合起来的编号记最近这么多版。 */
const KEEP = 40;

export interface FrameHost {
  call(tabId: string, op: string, args: Record<string, unknown>): Promise<unknown>;
  callFrame(tabId: string, frame: FrameRef, op: string, args: Record<string, unknown>): Promise<unknown>;
  crossFrames(tabId: string): FrameRef[];
}

interface Section {
  frame: FrameRef | null;
  version: string;
  base: number;
  count: number;
}

/** 编号 n 落在的那个框（null 是主页面）、框里的版本和第几号。 */
export interface FrameRoute {
  frame: FrameRef | null;
  version: string;
  n: number | undefined;
  base: number;
}

type Page = Record<string, unknown>;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export class TabFrames {
  readonly #host: FrameHost;
  readonly #combined = new Map<string, Section[]>();

  constructor(host: FrameHost) {
    this.#host = host;
  }

  async #page(tabId: string, frame: FrameRef | null, base: number): Promise<Page | null> {
    const request = { request: { op: 'perceive', frames: 'inline', base } };
    const page = frame === null ? await this.#host.call(tabId, 'operate', request)
      : await this.#host.callFrame(tabId, frame, 'operate', request);
    return Value.Check(PagePerceptionSchema, page) ? page as Page : null;
  }

  async #shown(tabId: string, frame: FrameRef): Promise<boolean> {
    const size = await this.#host.callFrame(tabId, frame, 'viewport', {}) as { width?: unknown; height?: unknown };
    return Number(size.width) >= FRAME_MIN_WIDTH && Number(size.height) >= FRAME_MIN_HEIGHT;
  }

  /** 一个跨源框：太小或看不见的回 'hidden'（不算没读到），读不出来回 null。 */
  async #read(tabId: string, frame: FrameRef, base: number): Promise<Page | 'hidden' | null> {
    try {
      return await this.#shown(tabId, frame) ? await this.#page(tabId, frame, base) : 'hidden';
    } catch {
      return null;
    }
  }

  /** 读整页：主页面（连同源内嵌框）再接上看得见的跨源内嵌框。 */
  async perceive(tabId: string): Promise<Page | null> {
    const main = await this.#page(tabId, null, 0);
    if (main === null || Number(main.frameCount ?? 0) === 0) {
      return main;
    }
    const elements = [...main.elements as unknown[]];
    const sections: Section[] = [{ frame: null, version: String(main.version), base: 0, count: elements.length }];
    const outlines = [String(main.outline)];
    const digests = [String(main.digest)];
    let truncated = main.truncated === true;
    let totalChars = Number(main.totalChars);
    let unread = 0;
    for (const frame of this.#host.crossFrames(tabId).slice(0, FRAMES_MAX)) {
      if (elements.length >= PAGE_ELEMENTS_MAX) {
        truncated = true;
        break;
      }
      const page = await this.#read(tabId, frame, elements.length);
      if (page === 'hidden') {
        continue;
      }
      if (page === null) {
        unread += 1;
        continue;
      }
      const items = (page.elements as unknown[]).slice(0, PAGE_ELEMENTS_MAX - elements.length);
      sections.push({ frame, version: String(page.version), base: elements.length, count: items.length });
      elements.push(...items);
      outlines.push(`〔内嵌框：${hostOf(frame.url)}〕\n${String(page.outline)}`);
      digests.push(String(page.digest));
      truncated ||= page.truncated === true || items.length < (page.elements as unknown[]).length;
      totalChars += Number(page.totalChars);
    }
    if (sections.length === 1) {
      return { ...main, frameCount: unread };
    }
    const version = createHash('sha256').update(JSON.stringify(sections.map((section) => [section.frame?.processId,
      section.frame?.routingId, section.version, section.base, section.count]))).digest('hex').slice(0, 16);
    this.#remember(tabId, version, sections);
    const outline = outlines.join('\n\n');
    return { ...main, version, elements, outline: outline.slice(0, PAGE_OUTLINE_MAX_CHARS),
      truncated: truncated || outline.length > PAGE_OUTLINE_MAX_CHARS, totalChars, frameCount: unread,
      digest: createHash('sha256').update(digests.join('|')).digest('hex').slice(0, 16) };
  }

  #remember(tabId: string, version: string, sections: Section[]): void {
    const key = `${tabId}:${version}`;
    this.#combined.delete(key);
    this.#combined.set(key, sections);
    for (const old of this.#combined.keys()) {
      if (this.#combined.size <= KEEP) {
        break;
      }
      this.#combined.delete(old);
    }
  }

  /** 编号 n（不给是翻整页）落在哪个框；合起来的那一版找不到这个编号回 null（过期了）。 */
  route(tabId: string, version: string, n: number | undefined): FrameRoute | null {
    const sections = this.#combined.get(`${tabId}:${version}`);
    if (sections === undefined) {
      return { frame: null, version, n, base: 0 };
    }
    const main = sections[0];
    if (n === undefined) {
      return main === undefined ? null : { frame: null, version: main.version, n, base: 0 };
    }
    const section = sections.find((item) => n > item.base && n <= item.base + item.count);
    return section === undefined ? null : { frame: section.frame, version: section.version, n: n - section.base,
      base: section.base };
  }

  /** 按路由叫主页面或那个框里的脚本。 */
  call(tabId: string, route: FrameRoute, op: string, args: Record<string, unknown>): Promise<unknown> {
    return route.frame === null ? this.#host.call(tabId, op, args) : this.#host.callFrame(tabId, route.frame, op, args);
  }
}
