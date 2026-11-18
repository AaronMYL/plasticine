// 导出的网页文件里带着原样的空间（标题、体裁、正文片段），再导入回来时一字不差（11-18 设计稿：HTML 是单个文件，
// 离线能开）。放在一个 type="application/json" 的 script 里：浏览器不跑它；里面的 < 写成 <，不会提前收口。

export const SPACE_MARKER_ID = 'plasticine-space';

export interface SpaceMarker {
  title: string;
  genre: 'report' | 'letter';
  html: string;
}

export function spaceMarkerScript(marker: SpaceMarker): string {
  const json = JSON.stringify(marker).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${SPACE_MARKER_ID}">${json}</script>`;
}

/** 网页文件里带的原样空间；没有或写坏了是 null。 */
export function readSpaceMarker(page: string): SpaceMarker | null {
  const pattern = new RegExp(`<script[^>]*\\bid=["']${SPACE_MARKER_ID}["'][^>]*>([\\s\\S]*?)</script>`, 'i');
  const json = pattern.exec(page)?.[1];
  if (json === undefined) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== 'object' || value === null) return null;
    const title: unknown = Reflect.get(value, 'title');
    const genre: unknown = Reflect.get(value, 'genre');
    const html: unknown = Reflect.get(value, 'html');
    if (typeof title !== 'string' || typeof html !== 'string' || (genre !== 'report' && genre !== 'letter')) {
      return null;
    }
    return { title, genre, html };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
