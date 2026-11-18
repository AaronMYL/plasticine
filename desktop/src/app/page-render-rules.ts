// 出 PDF、长图（page-render.ts）的两条规矩，单拿出来好测（不引 electron）。

/** 长图最高这么多像素；再高截到这里。 */
const SHOT_MAX_HEIGHT = 16_000;

/** 这一页能去拿的地址：只有页面自己和它带着的 data: / blob:。 */
export function renderRequestAllowed(url: string, pages: ReadonlySet<string>): boolean {
  return pages.has(url.split('#')[0] ?? '') || /^(data|blob|about|devtools):/i.test(url);
}

/** 长图的高和清晰度：不太长的两倍清晰，太长的一倍，再长截到上限。 */
export function shotSize(height: number): { height: number; scale: 1 | 2 } {
  const clipped = Math.max(1, Math.min(SHOT_MAX_HEIGHT, Math.ceil(height)));
  return { height: clipped, scale: clipped * 2 <= SHOT_MAX_HEIGHT ? 2 : 1 };
}
