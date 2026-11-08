// 文件页（/v2/files）的真实现：围着状态目录里的工作目录。下载走同源链接（cookie 会话），浏览器自己下载，不经 fetch、
// 不进 JSON。

import type { FilesApi } from '../m5b-client.ts';
import {
  FILES_CONTENT_PATH,
  FILES_FOLDERS_PATH,
  FILES_MOVE_PATH,
  FILES_PATH,
  FILES_RESTORE_PATH,
  FILES_TRASH_PATH,
  FILES_UPLOAD_PATH,
  FileEntryResponseSchema,
  FileListResponseSchema,
  FileTextViewSchema, type WriteFileTextRequest,
  TrashFileResponseSchema,
  TrashListResponseSchema,
  type CreateFolderRequest,
  type FileEntryView,
  type FileListResponse,
  type MoveFileRequest,
  type RestoreFileRequest,
  type TrashEntryView,
  type TrashFileRequest,
  type TrashListResponse,
  type UploadFileRequest,
} from '../shared.ts';
import { conflictWith } from './conflict.ts';
import type { Transport } from './transport.ts';

// 一个文件 20 MB 的 base64 发出去要比平常久：给上传单独 2 分钟（默认值，接上后按实测再调）。
export const UPLOAD_TIMEOUT_MS = 120_000;

export class HttpFiles implements FilesApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  list(path: string, signal?: AbortSignal): Promise<FileListResponse> {
    return this.transport.request({
      method: 'GET',
      path: FILES_PATH,
      query: { path },
      schema: FileListResponseSchema,
      what: '读文件夹',
      lostAs: 'failed',
      signal,
    });
  }

  downloadUrl(path: string): string {
    return `${FILES_CONTENT_PATH}?path=${encodeURIComponent(path)}`;
  }

  readText(path: string, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: `${FILES_PATH}/text`, query: { path },
      schema: FileTextViewSchema, what: '读取文本', lostAs: 'failed', signal });
  }

  writeText(body: WriteFileTextRequest) {
    return this.transport.request({ method: 'PUT', path: `${FILES_PATH}/text`, body,
      schema: FileTextViewSchema, what: '保存文本', lostAs: 'uncertain' });
  }

  upload(input: UploadFileRequest): Promise<FileEntryView> {
    return this.entry(FILES_UPLOAD_PATH, input, '上传', UPLOAD_TIMEOUT_MS);
  }

  createFolder(input: CreateFolderRequest): Promise<FileEntryView> {
    return this.entry(FILES_FOLDERS_PATH, input, '新建文件夹');
  }

  move(input: MoveFileRequest): Promise<FileEntryView> {
    return this.entry(FILES_MOVE_PATH, input, '改名或移动');
  }

  async trash(input: TrashFileRequest): Promise<TrashEntryView> {
    const response = await this.transport.request({
      method: 'POST',
      path: FILES_TRASH_PATH,
      body: input,
      schema: TrashFileResponseSchema,
      what: '删除',
      lostAs: 'uncertain',
    });
    return response.trashed;
  }

  trashed(signal?: AbortSignal): Promise<TrashListResponse> {
    return this.transport.request({
      method: 'GET',
      path: FILES_TRASH_PATH,
      schema: TrashListResponseSchema,
      what: '读回收',
      lostAs: 'failed',
      signal,
    });
  }

  restore(input: RestoreFileRequest): Promise<FileEntryView> {
    return this.entry(FILES_RESTORE_PATH, input, '还原');
  }

  private async entry(path: string, body: unknown, what: string, timeoutMs?: number): Promise<FileEntryView> {
    const response = await this.transport.request({
      method: 'POST',
      path,
      body,
      schema: FileEntryResponseSchema,
      what,
      lostAs: 'uncertain',
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    return response.entry;
  }
}
