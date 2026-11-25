import { Type, type Static } from 'typebox';
import { WORKSPACE_PATH_MAX_CHARS } from '../state.ts';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const FILES_PATH = `${API_PREFIX}/files`;
export const FILES_CONTENT_PATH = `${FILES_PATH}/content`;
export const FILES_UPLOAD_PATH = `${FILES_PATH}/upload`;
export const FILES_FOLDERS_PATH = `${FILES_PATH}/folders`;
export const FILES_MOVE_PATH = `${FILES_PATH}/move`;
export const FILES_TRASH_PATH = `${FILES_PATH}/trash`;
export const FILES_RESTORE_PATH = `${FILES_PATH}/restore`;
export const FILES_TABLE_PATH = `${FILES_PATH}/table`;
export const TABLE_EXPORT_ROWS_MAX = 200;
export const TABLE_EXPORT_COLUMNS_MAX = 20;
export const FILE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const FILE_UPLOAD_BODY_MAX_BYTES = Math.ceil((FILE_UPLOAD_MAX_BYTES * 4) / 3) + 64 * 1024;

const Path = Type.String({ maxLength: WORKSPACE_PATH_MAX_CHARS });
const Name = Type.String({ minLength: 1, maxLength: 255 });

export const FileEntryViewSchema = Type.Object({
  name: Type.String(),
  path: Type.String(),
  kind: Type.Enum(['file', 'directory', 'other']),
  bytes: Type.Integer({ minimum: 0 }),
  modifiedAt: IsoTimeSchema,
  type: OrNull(Type.String()),
});
export type FileEntryView = Static<typeof FileEntryViewSchema>;

export const FileListResponseSchema = Type.Object({
  path: Type.String(),
  parent: OrNull(Type.String()),
  entries: Type.Array(FileEntryViewSchema),
  freeBytes: Type.Optional(Type.Number({ minimum: 0 })),
});
export type FileListResponse = Static<typeof FileListResponseSchema>;

/** POST /v2/files/upload → 201 { entry } */
export const UploadFileRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    directory: Path,
    name: Name,
    contentBase64: Type.String({ maxLength: Math.ceil((FILE_UPLOAD_MAX_BYTES * 4) / 3) + 4 }),
    overwrite: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type UploadFileRequest = Static<typeof UploadFileRequestSchema>;

/** POST /v2/files/folders → 201 { entry } */
export const CreateFolderRequestSchema = Type.Object(
  { requestId: RequestIdSchema, path: Type.String({ minLength: 1, maxLength: WORKSPACE_PATH_MAX_CHARS }) },
  { additionalProperties: false },
);
export type CreateFolderRequest = Static<typeof CreateFolderRequestSchema>;

export const MoveFileRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    from: Type.String({ minLength: 1, maxLength: WORKSPACE_PATH_MAX_CHARS }),
    to: Type.String({ minLength: 1, maxLength: WORKSPACE_PATH_MAX_CHARS }),
    confirmName: Name,
  },
  { additionalProperties: false },
);
export type MoveFileRequest = Static<typeof MoveFileRequestSchema>;

const TableRow = Type.Array(Type.String({ maxLength: 2000 }), { maxItems: TABLE_EXPORT_COLUMNS_MAX });

export const ExportTableRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    title: Type.String({ minLength: 1, maxLength: 80 }),
    header: Type.Array(Type.String({ maxLength: 200 }), { minItems: 1, maxItems: TABLE_EXPORT_COLUMNS_MAX }),
    rows: Type.Array(TableRow, { maxItems: TABLE_EXPORT_ROWS_MAX }),
    total: Type.Optional(TableRow),
  },
  { additionalProperties: false },
);
export type ExportTableRequest = Static<typeof ExportTableRequestSchema>;

export const FileEntryResponseSchema = Type.Object({ entry: FileEntryViewSchema });
export type FileEntryResponse = Static<typeof FileEntryResponseSchema>;

export const TrashEntryViewSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  originalPath: Type.String(),
  trashedAt: IsoTimeSchema,
});
export type TrashEntryView = Static<typeof TrashEntryViewSchema>;

export const TrashFileRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    path: Type.String({ minLength: 1, maxLength: WORKSPACE_PATH_MAX_CHARS }),
    confirmName: Name,
  },
  { additionalProperties: false },
);
export type TrashFileRequest = Static<typeof TrashFileRequestSchema>;
export const TrashFileResponseSchema = Type.Object({ trashed: TrashEntryViewSchema });
export type TrashFileResponse = Static<typeof TrashFileResponseSchema>;
export const TrashListResponseSchema = Type.Object({ entries: Type.Array(TrashEntryViewSchema) });
export type TrashListResponse = Static<typeof TrashListResponseSchema>;

export const RestoreFileRequestSchema = Type.Object(
  { requestId: RequestIdSchema, id: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false },
);
export type RestoreFileRequest = Static<typeof RestoreFileRequestSchema>;

export const FileTextViewSchema = Type.Object({ path: Type.String(), text: Type.String(), version: Type.String() });
export type FileTextView = Static<typeof FileTextViewSchema>;
export const WriteFileTextRequestSchema = Type.Object({ requestId: RequestIdSchema, path: Path,
  text: Type.String({ maxLength: 1_000_000 }), version: OrNull(Type.String()) }, { additionalProperties: false });
export type WriteFileTextRequest = Static<typeof WriteFileTextRequestSchema>;
