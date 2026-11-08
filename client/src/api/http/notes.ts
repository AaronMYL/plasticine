// /v2/notes 的真实现：服务端全文搜索和分页、读、新建、保存（带 version，409 带当前那一版）、软删与恢复。
// 写成功后在本机报 note.* 事件；服务端的 note_invalidated 也会通过 SSE 同步到已打开的笔记。

import { Value } from 'typebox/value';
import type { NotesApi } from '../client.ts';
import { badResponseError, NoteConflictError } from '../errors.ts';
import { toMeta } from '../note-meta.ts';
import { NOTE_LIST_MAX, NoteConflictSchema, NoteListResponseSchema, NOTES_PATH, NoteViewSchema } from '../shared.ts';
import { NoteFoldersViewSchema, NoteImageViewSchema, NoteAssistViewSchema, NoteImportViewSchema } from '../shared.ts';
import { noteAssistTimeoutMs } from '../shared.ts';
import type { NoteFolderCommand, NoteFoldersView, NoteImageRequest, NoteImageView,
  NoteAssistRequest, NoteAssistView, NoteImportView } from '../shared.ts';
import type { NoteListResponse } from '../shared.ts';
import type { CreateNoteRequest, NoteMetaView, NoteSearch, NoteView, SaveNoteRequest } from '../types.ts';
import type { LocalEvents } from './local-events.ts';
import type { Transport } from './transport.ts';

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
    const graceMs = input.action === 'predict' ? 5000 : 10_000;
    return this.transport.request({ method: 'POST', path: `${notePath(id)}/assist`, body: input,
      schema: NoteAssistViewSchema, what: '笔记建议', lostAs: 'failed',
      timeoutMs: noteAssistTimeoutMs(input) + graceMs, signal });
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
