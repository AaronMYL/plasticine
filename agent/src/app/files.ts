// /v2/files: 文件页——列一个文件夹、下载一个文件（不缓存、当附件下载，不在本站当网页打开）、上传（base64，按类型和大小
// 收；请求体单独放宽到 20 MB 的文件）、新建文件夹、改名 / 移动、挪进回收、列回收、还原。写操作按 requestId 幂等；改名、
// 移动、删除要打一遍现在的名字确认（artifacts/workspace.ts 核）。路径一律在状态目录的 files/ 里。

import {
  CreateFolderRequestSchema,
  WriteFileTextRequestSchema,
  FILE_UPLOAD_BODY_MAX_BYTES,
  MoveFileRequestSchema,
  RestoreFileRequestSchema,
  TrashFileRequestSchema,
  UploadFileRequestSchema,
  type FileEntryResponse,
  type FileListResponse,
  type TrashFileResponse,
  type TrashListResponse,
} from '../../shared/api/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { fileEntryView, trashEntryView } from './m5b-views.ts';
import { checkInput } from './validate.ts';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function pathParam(context: RequestContext): string {
  return context.url.searchParams.get('path') ?? '';
}

/** GET /v2/files?path= */
export function listFiles(context: RequestContext): Reply {
  requireAuth(context);
  const listing = context.deps.m5b.artifacts.workspace.list(pathParam(context));
  const body: FileListResponse = { ...listing, entries: listing.entries.map(fileEntryView) };
  return { status: 200, body };
}

/** GET /v2/files/content?path= */
export function downloadFile(context: RequestContext): Reply {
  requireAuth(context);
  const { data, entry } = context.deps.m5b.artifacts.workspace.read(pathParam(context));
  return { status: 200, bytes: { data, type: entry.type ?? 'application/octet-stream', download: entry.name } };
}

export function readTextFile(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: context.deps.m5b.artifacts.workspace.readText(pathParam(context)) };
}

export async function writeTextFile(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(WriteFileTextRequestSchema, await readJsonBody(context.req), '保存文本文件');
  return idempotent(context, body.requestId, () => ({ status: 200,
    body: context.deps.m5b.artifacts.workspace.writeText(body.path, body.text, body.version) }));
}

/** POST /v2/files/upload */
export async function uploadFile(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBody(context.req, FILE_UPLOAD_BODY_MAX_BYTES);
  const body = checkInput(UploadFileRequestSchema, raw, '上传');
  if (!BASE64.test(body.contentBase64)) {
    throw new ApiError(400, 'invalid_request', '文件内容不是 base64。', { field: 'contentBase64' });
  }
  const data = Buffer.from(body.contentBase64, 'base64');
  const { workspace } = context.deps.m5b.artifacts;
  return idempotent(context, body.requestId, () => {
    const entry = workspace.upload(body.directory, body.name, data, body.overwrite ?? false);
    const response: FileEntryResponse = { entry: fileEntryView(entry) };
    return { status: 201, body: response };
  });
}

/** POST /v2/files/folders */
export async function createFolder(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(CreateFolderRequestSchema, await readJsonBody(context.req), '新建文件夹');
  const { workspace } = context.deps.m5b.artifacts;
  return idempotent(context, body.requestId, () => {
    const response: FileEntryResponse = { entry: fileEntryView(workspace.mkdir(body.path)) };
    return { status: 201, body: response };
  });
}

/** POST /v2/files/move */
export async function moveFile(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(MoveFileRequestSchema, await readJsonBody(context.req), '改名或移动');
  const { workspace } = context.deps.m5b.artifacts;
  return idempotent(context, body.requestId, () => {
    const response: FileEntryResponse = { entry: fileEntryView(workspace.move(body.from, body.to, body.confirmName)) };
    return { status: 200, body: response };
  });
}

/** POST /v2/files/trash */
export async function trashFile(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(TrashFileRequestSchema, await readJsonBody(context.req), '删除');
  const { workspace } = context.deps.m5b.artifacts;
  return idempotent(context, body.requestId, () => {
    const response: TrashFileResponse = { trashed: trashEntryView(workspace.trash(body.path, body.confirmName)) };
    return { status: 200, body: response };
  });
}

/** GET /v2/files/trash */
export function listTrash(context: RequestContext): Reply {
  requireAuth(context);
  const body: TrashListResponse = { entries: context.deps.m5b.artifacts.workspace.trashed().map(trashEntryView) };
  return { status: 200, body };
}

/** POST /v2/files/restore */
export async function restoreFile(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(RestoreFileRequestSchema, await readJsonBody(context.req), '还原');
  const { workspace } = context.deps.m5b.artifacts;
  return idempotent(context, body.requestId, () => {
    const response: FileEntryResponse = { entry: fileEntryView(workspace.restore(body.id)) };
    return { status: 200, body: response };
  });
}
