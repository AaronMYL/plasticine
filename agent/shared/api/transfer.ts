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

export const TRANSFER_BODY_MAX_BYTES = FILE_UPLOAD_BODY_MAX_BYTES;
export const NOTE_IMPORT_MAX_FILES = 200;
export const TRANSFER_EXPORT_MAX = 500;

export const TransferFileSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  contentBase64: Type.String({ maxLength: Math.ceil((FILE_UPLOAD_MAX_BYTES * 4) / 3) + 4 }),
}, STRICT);
export type TransferFileInput = Static<typeof TransferFileSchema>;

export const SkippedFileSchema = Type.Object({ name: Type.String(), reason: Type.String() });
export type SkippedFileView = Static<typeof SkippedFileSchema>;

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

export const ExportNotesRequestSchema = Type.Object({
  ids: Type.Array(IdSchema, { minItems: 1, maxItems: TRANSFER_EXPORT_MAX }),
}, STRICT);
export type ExportNotesRequest = Static<typeof ExportNotesRequestSchema>;

export const SPACE_EXPORT_FORMATS = ['html', 'pdf', 'markdown', 'docx', 'png'] as const;
export type SpaceExportFormat = (typeof SPACE_EXPORT_FORMATS)[number];
export const SPACE_IMPORT_MAX_FILES = 50;

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

export const ExportSpacesRequestSchema = Type.Object({
  ids: Type.Array(IdSchema, { minItems: 1, maxItems: TRANSFER_EXPORT_MAX }),
  format: Type.Enum(['markdown', 'docx']),
}, STRICT);
export type ExportSpacesRequest = Static<typeof ExportSpacesRequestSchema>;

export const RenderPageRequestSchema = Type.Object({
  html: Type.String({ minLength: 1, maxLength: TRANSFER_BODY_MAX_BYTES }),
  format: Type.Enum(['pdf', 'png']),
  name: Type.String({ minLength: 1, maxLength: 200 }),
}, STRICT);
export type RenderPageRequest = Static<typeof RenderPageRequestSchema>;
