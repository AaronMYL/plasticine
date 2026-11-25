import { Type, type Static } from 'typebox';
import { NOTE_IMAGE_MAX_BYTES } from './notes-workspace.ts';

const STRICT = { additionalProperties: false };

export const WEB_PAGE_TOOLS = [
  'find', 'zoom', 'capture', 'capture_full', 'print', 'circle', 'thumbnail', 'downloads', 'perceive',
  'extract_marks', 'extract_images',
] as const;
export type WebPageToolName = (typeof WEB_PAGE_TOOLS)[number];

export const WEB_ZOOM_MIN = 0.5;
export const WEB_ZOOM_MAX = 3;
export const WEB_FIND_MAX_CHARS = 500;
export const WEB_CIRCLE_TEXT_MAX_CHARS = 20_000;
export const WEB_IMAGE_MAX_BYTES = NOTE_IMAGE_MAX_BYTES;
export const WEB_THUMBNAIL_WIDTH = 560;

export const WebExtractMarkSchema = Type.Object({ quote: Type.String({ minLength: 1, maxLength: 1000 }),
  context: Type.String({ maxLength: 60_000 }) }, STRICT);
export const WebExtractToolSchema = Type.Union([
  Type.Object({ kind: Type.Literal('extract_marks'), points: Type.Array(WebExtractMarkSchema, { maxItems: 12 }),
    focus: Type.Optional(Type.Integer({ minimum: 0, maximum: 11 })),
    color: Type.Optional(Type.String({ maxLength: 150 })) }, STRICT),
  Type.Object({ kind: Type.Literal('extract_images') }, STRICT),
]);
export const WebPageToolSchema = Type.Union([
  WebExtractToolSchema,
  Type.Object({ kind: Type.Literal('find'), query: Type.String({ minLength: 1, maxLength: WEB_FIND_MAX_CHARS }),
    backwards: Type.Boolean() }, STRICT),
  Type.Object({ kind: Type.Literal('find_clear') }, STRICT),
  Type.Object({ kind: Type.Literal('zoom'), factor: Type.Number({ minimum: WEB_ZOOM_MIN, maximum: WEB_ZOOM_MAX }) },
    STRICT),
  Type.Object({ kind: Type.Literal('capture'), scope: Type.Union([Type.Literal('visible'), Type.Literal('full')]) },
    STRICT),
  Type.Object({ kind: Type.Literal('print') }, STRICT),
  Type.Object({ kind: Type.Literal('circle') }, STRICT),
  Type.Object({ kind: Type.Literal('circle_cancel') }, STRICT),
  Type.Object({ kind: Type.Literal('thumbnail') }, STRICT),
  Type.Object({ kind: Type.Literal('downloads') }, STRICT),
  Type.Object({ kind: Type.Literal('perceive') }, STRICT),
]);
export type WebPageTool = Static<typeof WebPageToolSchema>;

export const WebFindResultSchema = Type.Object({ found: Type.Boolean() }, STRICT);
export type WebFindResult = Static<typeof WebFindResultSchema>;

export const WebPageImageSchema = Type.Object({
  type: Type.Union([Type.Literal('image/png'), Type.Literal('image/jpeg')]),
  base64: Type.String({ minLength: 1, maxLength: Math.ceil(WEB_IMAGE_MAX_BYTES / 3) * 4 }),
}, STRICT);
export type WebPageImage = Static<typeof WebPageImageSchema>;

export const WebCircleResultSchema = Type.Object({
  text: Type.String({ maxLength: WEB_CIRCLE_TEXT_MAX_CHARS }),
  url: Type.String({ maxLength: 4_096 }),
  title: Type.String({ maxLength: 1_000 }),
}, STRICT);
export type WebCircleResult = Static<typeof WebCircleResultSchema>;

export const WEB_MENU_COMMANDS = ['find', 'print', 'history'] as const;
export type WebMenuCommand = (typeof WEB_MENU_COMMANDS)[number];
