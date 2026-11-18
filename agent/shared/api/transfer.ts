// 导入导出（11-18）：笔记和资料库里的空间。
// - POST /v2/notes/import：一次选的几个 .md / .txt 各成一篇笔记 → { imported, skipped }（没导入的带原因）。
// - POST /v2/notes/export：{ ids } → 文件的字节：一篇没有图的是 .md，其余是 zip；文件名在 Content-Disposition 里。
// 文件内容一律 base64：文字文件的编码由本体认（GBK 的 txt 也读得出来），Word 是二进制。

import { Type, type Static } from 'typebox';
import { NoteFolderSchema } from '../state.ts';
import { IdSchema, RequestIdSchema } from './common.ts';
import { FILE_UPLOAD_BODY_MAX_BYTES, FILE_UPLOAD_MAX_BYTES } from './files.ts';
import { NOTES_PATH, NoteMetaViewSchema } from './notes.ts';

const STRICT = { additionalProperties: false };

export const NOTES_IMPORT_PATH = `${NOTES_PATH}/import`;
export const NOTES_EXPORT_PATH = `${NOTES_PATH}/export`;

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
