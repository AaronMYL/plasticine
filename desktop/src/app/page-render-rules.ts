const SHOT_MAX_HEIGHT = 16_000;

export function renderRequestAllowed(url: string, pages: ReadonlySet<string>): boolean {
  return pages.has(url.split('#')[0] ?? '') || /^(data|blob|about|devtools):/i.test(url);
}

export function shotSize(height: number): { height: number; scale: 1 | 2 } {
  const clipped = Math.max(1, Math.min(SHOT_MAX_HEIGHT, Math.ceil(height)));
  return { height: clipped, scale: clipped * 2 <= SHOT_MAX_HEIGHT ? 2 : 1 };
}
