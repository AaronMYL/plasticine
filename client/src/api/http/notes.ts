import { BatchResponseSchema, NOTES_BATCH_PATH, NOTES_EMPTY_PATH, type NotesBatchRequest,
  type EmptyTrashRequest } from '../shared.ts';
// /v2/notes 的真实现：服务端全文搜索和分页、读、新建、保存（带 version，409 带当前那一版）、软删与恢复。
// 写成功后在本机报 note.* 事件；服务端的 note_invalidated 也会通过 SSE 同步到已打开的笔记。

import { Value } from 'typebox/value';
import type { NotesApi } from '../client.ts';
import { ApiError, badResponseError, NoteConflictError } from '../errors.ts';
import { toMeta } from '../note-meta.ts';
import { NOTE_LIST_MAX, NoteConflictSchema, NoteListResponseSchema, NOTES_PATH, NoteViewSchema } from '../shared.ts';
import { NoteFoldersViewSchema, NoteImageViewSchema, NoteAssistViewSchema, NoteImportViewSchema } from '../shared.ts';
import { noteAssistTimeoutMs, NoteAssistStreamEventSchema } from '../shared.ts';
import type { NoteFolderCommand, NoteFoldersView, NoteImageRequest, NoteImageView,
  NoteAssistRequest, NoteAssistView, NoteImportView } from '../shared.ts';
import type { NoteListResponse } from '../shared.ts';
import type { CreateNoteRequest, NoteMetaView, NoteSearch, NoteView, SaveNoteRequest } from '../types.ts';
import type { LocalEvents } from './local-events.ts';
import type { Transport } from './transport.ts';

/** 服务端的等待窗口再加一点：续写 5 秒，其余 10 秒（网络和排队的余量）。 */
function assistTimeoutMs(input: NoteAssistRequest): number {
  return noteAssistTimeoutMs(input) + (input.action === 'predict' ? 5000 : 10_000);
}

/** 一页 400 篇，翻这么多页还没完就是服务端的 nextOffset 有问题，停下来报错，不无限翻。 */
const NOTE_PAGES_MAX = 50;

function notePath(id: string): string {
  return `${NOTES_PATH}/${encodeURIComponent(id)}`;
}

/** 409 version_conflict 带着当前那一版：交给冲突横幅，不覆盖。 */
function conflictOf(status: number, body: unknown): NoteConflictError | undefined {
  if (status !== 409 || !Value.Check(NoteConflictSchema, body) || body.code !== 'version_conflict') {
    return undefined;
  }
  return new NoteConflictError(body.current, body.currentVersion ?? body.current.version);
}

export class HttpNotes implements NotesApi {
  private readonly transport: Transport;
  private readonly local: LocalEvents;

  constructor(transport: Transport, local: LocalEvents) {
    this.transport = transport;
    this.local = local;
  }

  async batch(input: NotesBatchRequest) {
    const result = await this.transport.request({ method: 'POST', path: NOTES_BATCH_PATH, body: input,
      schema: BatchResponseSchema, what: '批量处理笔记', lostAs: 'uncertain' });
    this.local.emit({ type: 'note.invalidated', noteId: 'folders' });
    for (const item of result.results) if (item.ok) this.local.emit({
      type: input.action === 'purge' || input.action === 'trash' ? 'note.deleted' : 'note.invalidated', noteId: item.id });
    return result;
  }

  async emptyTrash(input: EmptyTrashRequest) {
    const result = await this.transport.request({ method: 'POST', path: NOTES_EMPTY_PATH, body: input,
      schema: BatchResponseSchema, what: '清空最近删除', lostAs: 'uncertain' });
    this.local.emit({ type: 'note.invalidated', noteId: 'folders' });
    for (const item of result.results) if (item.ok) this.local.emit({ type: 'note.deleted', noteId: item.id });
    return result;
  }

  async list(query: NoteSearch, signal?: AbortSignal): Promise<NoteMetaView[]> {
    const notes: NoteMetaView[] = [];
    let offset: number | null = 0;
    for (let page = 0; offset !== null; page += 1) {
      if (page >= NOTE_PAGES_MAX) {
        throw badResponseError('读笔记列表', `翻了 ${NOTE_PAGES_MAX} 页还没完`, false);
      }
      const response: NoteListResponse = await this.transport.request({
        method: 'GET',
        path: NOTES_PATH,
        query: { ...query, limit: NOTE_LIST_MAX, offset },
        schema: NoteListResponseSchema,
        what: '读笔记列表',
        lostAs: 'failed',
        signal,
      });
      notes.push(...response.notes);
      if (response.nextOffset !== null && response.nextOffset <= offset) {
        throw badResponseError('读笔记列表', `下一页的 offset ${response.nextOffset} 没有往后走`, false);
      }
      offset = response.nextOffset;
    }
    return notes;
  }

  async folders(signal?: AbortSignal): Promise<NoteFoldersView> {
    return this.transport.request({ method: 'GET', path: `${NOTES_PATH}/folders`,
      schema: NoteFoldersViewSchema, what: '读文件夹', lostAs: 'failed', signal });
  }
  async changeFolder(input: NoteFolderCommand): Promise<NoteFoldersView> {
    const result = await this.transport.request({ method: 'POST', path: `${NOTES_PATH}/folders`, body: input,
      schema: NoteFoldersViewSchema, what: '修改文件夹', lostAs: 'uncertain' });
    this.local.emit({ type: 'note.invalidated', noteId: 'folders' });
    return result;
  }
  async restore(id: string, requestId: string): Promise<NoteView> {
    const note = await this.transport.request({ method: 'POST', path: `${notePath(id)}/restore`, body: { requestId },
      schema: NoteViewSchema, what: '恢复笔记', lostAs: 'uncertain' });
    this.local.emit({ type: 'note.updated', note: toMeta(note) });
    return note;
  }
  async uploadImage(id: string, input: NoteImageRequest, signal?: AbortSignal): Promise<NoteImageView> {
    return this.transport.request({ method: 'POST', path: `${notePath(id)}/images`, body: input,
      schema: NoteImageViewSchema, what: '上传图片', lostAs: 'uncertain', timeoutMs: 60_000, signal });
  }
  async assist(id: string, input: NoteAssistRequest, signal?: AbortSignal): Promise<NoteAssistView> {
    return this.transport.request({ method: 'POST', path: `${notePath(id)}/assist`, body: input,
      schema: NoteAssistViewSchema, what: '笔记建议', lostAs: 'failed', timeoutMs: assistTimeoutMs(input), signal });
  }
  async assistStream(id: string, input: NoteAssistRequest, onText: (delta: string) => void,
    signal?: AbortSignal): Promise<NoteAssistView> {
    let view: NoteAssistView | null = null;
    let failure: ApiError | null = null;
    await this.transport.stream({ method: 'POST', path: `${notePath(id)}/assist`, body: { ...input, stream: true },
      schema: NoteAssistStreamEventSchema, what: '笔记建议', lostAs: 'failed', timeoutMs: assistTimeoutMs(input),
      signal }, (event) => {
      if (event.type === 'text') {
        onText(event.delta);
      } else if (event.type === 'done') {
        view = event.view;
      } else {
        // 开始送之后才失败：服务端照普通错误回答的口径给了文案，没有状态码可分，算失败。
        failure = new ApiError({ kind: 'failed', code: event.error.code, message: event.error.error,
          next: event.error.next, field: event.error.field });
      }
    });
    if (failure !== null) {
      throw failure;
    }
    if (view === null) {
      throw badResponseError('笔记建议', '没给最终文字就结束了', false);
    }
    return view;
  }
  async imported(id: string, signal?: AbortSignal): Promise<NoteImportView> {
    return this.transport.request({ method: 'GET', path: `${notePath(id)}/import`,
      schema: NoteImportViewSchema, what: '读导入版本', lostAs: 'failed', signal });
  }

  async get(id: string, signal?: AbortSignal): Promise<NoteView> {
    return this.transport.request({
      method: 'GET',
      path: notePath(id),
      schema: NoteViewSchema,
      what: '读笔记',
      lostAs: 'failed',
      signal,
    });
  }

  async create(input: CreateNoteRequest): Promise<NoteView> {
    const note = await this.transport.request({
      method: 'POST',
      path: NOTES_PATH,
      body: input,
      schema: NoteViewSchema,
      what: '新建笔记',
      lostAs: 'uncertain',
    });
    this.local.emit({ type: 'note.updated', note: toMeta(note) });
    return note;
  }

  async save(id: string, input: SaveNoteRequest): Promise<NoteView> {
    const note = await this.transport.request({
      method: 'PUT',
      path: notePath(id),
      body: input,
      schema: NoteViewSchema,
      what: '保存笔记',
      lostAs: 'uncertain',
      refine: conflictOf,
    });
    this.local.emit({ type: 'note.updated', note: toMeta(note) });
    return note;
  }

  async remove(id: string, requestId: string): Promise<NoteView> {
    const note = await this.transport.request({
      method: 'DELETE',
      path: notePath(id),
      body: { requestId },
      schema: NoteViewSchema,
      what: '删除笔记',
      lostAs: 'uncertain',
    });
    this.local.emit({ type: 'note.deleted', noteId: id });
    return note;
  }
}
