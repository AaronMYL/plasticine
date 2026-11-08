// /v2/files: 文件页（《UI 方案》第 9 节：「手」的工作目录；这一版收在状态目录的 files/ 里）。路径一律相对于它的根，用 /
// 分段。上传一个文件最多 20 MB，按类型收（扩展名 + 开头的字节）；内容用 base64 放在 JSON 里。改名 / 移动 / 删除要打一遍
// 现在的名字确认；删除是挪进回收（可还原），永久删除这一版没有。

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
/** 1ca0391 files.ts：上传最多 20 MB。 */
export const FILE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
// base64 把 3 个字节写成 4 个字，再留一点给其余的字段。
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

/** GET /v2/files?path= — 一个文件夹里有什么（文件夹在前）。 */
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

/** POST /v2/files/move → 200 { entry }：改名或移动；confirmName 是现在的名字，要一字不差。 */
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

export const FileEntryResponseSchema = Type.Object({ entry: FileEntryViewSchema });
export type FileEntryResponse = Static<typeof FileEntryResponseSchema>;

export const TrashEntryViewSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  originalPath: Type.String(),
  trashedAt: IsoTimeSchema,
});
export type TrashEntryView = Static<typeof TrashEntryViewSchema>;

/** POST /v2/files/trash → 200 { trashed }：挪进回收；confirmName 是它的名字。GET 同一路径列出回收里的。 */
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

/** POST /v2/files/restore → 200 { entry }：从回收还原到原来的位置（那里已经有同名的就 409）。 */
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
