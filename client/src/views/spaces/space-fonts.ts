import { WENKAI_FAMILY } from '../../../../agent/shared/space-page/base-css.ts';
import geistUrl from '../../fonts/Geist-Variable.woff2?url';
import geistMonoUrl from '../../fonts/GeistMono-Variable.woff2?url';
import type { SpaceFontFace } from './space-runtime.ts';

export const WENKAI_PACKAGE_FAMILY = 'LXGW WenKai';

interface WenkaiSlice {
  url: string;
  rangeText: string;
  ranges: [number, number][];
}

const buffers = new Map<string, Promise<ArrayBuffer>>();
let wenkai: Promise<WenkaiSlice[]> | null = null;

function bytes(url: string): Promise<ArrayBuffer> {
  let found = buffers.get(url);
  if (found === undefined) {
    // allow-exception: static asset fetch outside api/
    found = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`字体没读到（${response.status}）：${url}`);
      return response.arrayBuffer();
    });
    found.catch(() => buffers.delete(url));
    buffers.set(url, found);
  }
  return found;
}

export function parseUnicodeRange(text: string): [number, number][] {
  return text.split(',').flatMap((part): [number, number][] => {
    const body = part.trim().replace(/^u\+/i, '');
    if (body === '') return [];
    const [from = '', to] = body.split('-');
    const low = Number.parseInt(from.replace(/\?/g, '0'), 16);
    const high = Number.parseInt((to ?? from).replace(/\?/g, 'f'), 16);
    return Number.isFinite(low) && Number.isFinite(high) ? [[low, high]] : [];
  });
}

function slicesFromSheets(): WenkaiSlice[] {
  const slices: WenkaiSlice[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch (cause) {
      console.warn('有一张样式表读不了规则，跳过', cause);
      continue;
    }
    for (const rule of [...rules]) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const src = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue('src'))?.[1];
      const rangeText = rule.style.getPropertyValue('unicode-range');
      if (family !== WENKAI_PACKAGE_FAMILY || src === undefined || rangeText === '') continue;
      slices.push({ url: new URL(src, sheet.href ?? window.location.href).href, rangeText,
        ranges: parseUnicodeRange(rangeText) });
    }
  }
  return slices;
}

export function loadWenkai(): Promise<WenkaiSlice[]> {
  wenkai ??= import('lxgw-wenkai-webfont/lxgwwenkai-regular.css').then(() => slicesFromSheets(), (cause: unknown) => {
    wenkai = null;
    throw cause;
  });
  return wenkai;
}

function covers(slice: WenkaiSlice, code: number): boolean {
  return slice.ranges.some(([low, high]) => code >= low && code <= high);
}

export async function spaceFontFaces(wenkaiChars: string): Promise<SpaceFontFace[]> {
  const faces: Promise<SpaceFontFace>[] = [
    bytes(geistUrl).then((data) => ({ family: 'Geist', data, weight: '100 900' })),
    bytes(geistMonoUrl).then((data) => ({ family: 'Geist Mono', data, weight: '100 900' })),
  ];
  const chars = [...new Set(wenkaiChars)].map((char) => char.codePointAt(0) ?? 0).filter((code) => code > 0x20);
  if (chars.length > 0) {
    const slices = await loadWenkai();
    const needed = slices.filter((slice) => chars.some((code) => covers(slice, code)));
    faces.push(...needed.map((slice) => bytes(slice.url).then((data) => ({ family: WENKAI_FAMILY, data,
      weight: '400', unicodeRange: slice.rangeText }))));
  }
  const settled = await Promise.allSettled(faces);
  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}
