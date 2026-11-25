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
