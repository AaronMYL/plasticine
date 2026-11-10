export interface BookSpacePosition {
  bookId: string;
  chapter: number;
  offset: number;
}

export function bookSpacePosition(id: string): BookSpacePosition | null {
  const match = /^(.*):(\d+):(\d+)$/.exec(id);
  if (match === null || match[1] === '') return null;
  const chapter = Number(match[2]);
  const offset = Number(match[3]);
  if (!Number.isSafeInteger(chapter) || !Number.isSafeInteger(offset)) return null;
  try { return { bookId: decodeURIComponent(match[1]!), chapter, offset }; }
  catch (cause) { if (cause instanceof URIError) return null; throw cause; }
}
