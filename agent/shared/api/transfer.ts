// 导入导出（11-18）：笔记和资料库里的空间。
// - POST /v2/notes/import：一次选的几个 .md / .txt 各成一篇笔记 → { imported, skipped }（没导入的带原因）。
// - POST /v2/notes/export：{ ids } → 文件的字节：一篇没有图的是 .md，其余是 zip；文件名在 Content-Disposition 里。
// - POST /v2/spaces/import：Markdown、TXT、Word、网页文件各成一个空间（报告）→ { imported, skipped }。
// - POST /v2/spaces/export：{ ids, format: markdown | docx } → 文件的字节（多篇是 zip）。
// - POST /v2/render：界面拼好的整页网页 → PDF 或长图（借云端浏览器；桌面客户端自己出，不走这里）。
// 文件内容一律 base64：文字文件的编码由本体认（GBK 的 txt 也读得出来），Word 是二进制。

import { Type, type Static } from 'typebox';
import { NoteFolderSchema } from '../state.ts';
import { FILE_UPLOAD_BODY_MAX_BYTES, FILE_UPLOAD_MAX_BYTES } from './files.ts';
import { NOTES_PATH, NoteMetaViewSchema } from './notes.ts';
import { SPACES_PATH, SpaceListItemSchema } from './spaces.ts';
import { API_PREFIX, IdSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false };

export const NOTES_IMPORT_PATH = `${NOTES_PATH}/import`;
export const NOTES_EXPORT_PATH = `${NOTES_PATH}/export`;
export const SPACES_IMPORT_PATH = `${SPACES_PATH}/import`;
export const SPACES_EXPORT_PATH = `${SPACES_PATH}/export`;
export const PAGE_RENDER_PATH = `${API_PREFIX}/render`;

/** 一次请求的请求体最多这么大（和文件页上传一个 20 MB 的文件一样）。 */
export const TRANSFER_BODY_MAX_BYTES = FILE_UPLOAD_BODY_MAX_BYTES;
/** 一次最多导入这么多个文件。 */
export const NOTE_IMPORT_MAX_FILES = 200;
/** 一次最多导出这么多篇。 */
export const TRANSFER_EXPORT_MAX = 500;

export const TransferFileSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  contentBase64: Type.String({ maxLength: Math.ceil((FILE_UPLOAD_MAX_BYTES * 4) / 3) + 4 }),
}, STRICT);
export type TransferFileInput = Static<typeof TransferFileSchema>;

/** 没导入的一个文件和原因（「不是文字文件」）。 */
export const SkippedFileSchema = Type.Object({ name: Type.String(), reason: Type.String() });
export type SkippedFileView = Static<typeof SkippedFileSchema>;

/** POST /v2/notes/import → 200 { imported, skipped }。folder 不给就进「笔记」。 */
export const ImportNotesRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  folder: Type.Optional(NoteFolderSchema),
  files: Type.Array(TransferFileSchema, { minItems: 1, maxItems: NOTE_IMPORT_MAX_FILES }),
}, STRICT);
export type ImportNotesRequest = Static<typeof ImportNotesRequestSchema>;
export const ImportNotesResponseSchema = Type.Object({
  imported: Type.Array(NoteMetaViewSchema),
  skipped: Type.Array(SkippedFileSchema),
});
export type ImportNotesResponse = Static<typeof ImportNotesResponseSchema>;

/** POST /v2/notes/export → 200 文件的字节。 */
export const ExportNotesRequestSchema = Type.Object({
  ids: Type.Array(IdSchema, { minItems: 1, maxItems: TRANSFER_EXPORT_MAX }),
}, STRICT);
export type ExportNotesRequest = Static<typeof ExportNotesRequestSchema>;

/** 资料库导出的五种格式（11-18 用户定）。网页、PDF、长图由界面拼整页；Markdown、Word 由本体写。 */
export const SPACE_EXPORT_FORMATS = ['html', 'pdf', 'markdown', 'docx', 'png'] as const;
export type SpaceExportFormat = (typeof SPACE_EXPORT_FORMATS)[number];
/** 资料库一次最多导入这么多个文件（Word 带图大，比笔记少）。 */
export const SPACE_IMPORT_MAX_FILES = 50;

/** POST /v2/spaces/import → 200 { imported, skipped }。 */
export const ImportSpacesRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  files: Type.Array(TransferFileSchema, { minItems: 1, maxItems: SPACE_IMPORT_MAX_FILES }),
}, STRICT);
export type ImportSpacesRequest = Static<typeof ImportSpacesRequestSchema>;
export const ImportSpacesResponseSchema = Type.Object({
  imported: Type.Array(SpaceListItemSchema),
  skipped: Type.Array(SkippedFileSchema),
});
export type ImportSpacesResponse = Static<typeof ImportSpacesResponseSchema>;

/** POST /v2/spaces/export → 200 文件的字节。 */
export const ExportSpacesRequestSchema = Type.Object({
  ids: Type.Array(IdSchema, { minItems: 1, maxItems: TRANSFER_EXPORT_MAX }),
  format: Type.Enum(['markdown', 'docx']),
}, STRICT);
export type ExportSpacesRequest = Static<typeof ExportSpacesRequestSchema>;

/** POST /v2/render → 200 PDF 或 PNG 的字节；name 是下载时的文件名（不带扩展名）。 */
export const RenderPageRequestSchema = Type.Object({
  html: Type.String({ minLength: 1, maxLength: TRANSFER_BODY_MAX_BYTES }),
  format: Type.Enum(['pdf', 'png']),
  name: Type.String({ minLength: 1, maxLength: 200 }),
}, STRICT);
export type RenderPageRequest = Static<typeof RenderPageRequestSchema>;
