import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import { PAGE_ELEMENTS_MAX, PAGE_OUTLINE_MAX_CHARS, PagePerceptionSchema }
  from '../../../agent/shared/api/page-operate.ts';
import type { FrameRef } from './tab-views.ts';

const FRAMES_MAX = 10;
const FRAME_MIN_WIDTH = 40;
const FRAME_MIN_HEIGHT = 20;
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

  async #read(tabId: string, frame: FrameRef, base: number): Promise<Page | 'hidden' | null> {
    try {
      return await this.#shown(tabId, frame) ? await this.#page(tabId, frame, base) : 'hidden';
    } catch {
      return null;
    }
  }

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

  call(tabId: string, route: FrameRoute, op: string, args: Record<string, unknown>): Promise<unknown> {
    return route.frame === null ? this.#host.call(tabId, op, args) : this.#host.callFrame(tabId, route.frame, op, args);
  }
}
