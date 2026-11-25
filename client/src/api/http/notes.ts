import {
  BatchResponseSchema, ImportNotesResponseSchema, NOTE_LIST_MAX, NoteAssistOutcomeViewSchema,
  NoteAssistStreamEventSchema, noteAssistTimeoutMs,
  NoteAssistViewSchema, NoteConflictSchema, NoteFoldersViewSchema, NoteImageViewSchema, NoteImportViewSchema,
  NoteListResponseSchema, NOTES_BATCH_PATH, NOTES_EMPTY_PATH, NOTES_EXPORT_PATH, NOTES_IMPORT_PATH, NOTES_PATH,
  NoteViewSchema, type EmptyTrashRequest, type ImportNotesRequest, type ImportNotesResponse,
  type NoteAssistOutcome, type NoteAssistRequest, type NoteAssistView, type NoteFolderCommand, type NoteFoldersView,
  type NoteImageRequest, type NoteImageView, type NoteImportView, type NoteListResponse, type NotesBatchRequest,
} from '../shared.ts';
import { Value } from 'typebox/value';
import type { DownloadedFile, NotesApi } from '../client.ts';
import { ApiError, badResponseError, NoteConflictError } from '../errors.ts';
import { toMeta } from '../note-meta.ts';
import type { CreateNoteRequest, NoteMetaView, NoteSearch, NoteView, SaveNoteRequest } from '../types.ts';
import type { LocalEvents } from './local-events.ts';
import type { Transport } from './transport.ts';

function assistTimeoutMs(input: NoteAssistRequest): number {
  return noteAssistTimeoutMs(input) + (input.action === 'predict' ? 5000 : 10_000);
}

const TRANSFER_TIMEOUT_MS = 120_000;

const NOTE_PAGES_MAX = 50;

function notePath(id: string): string {
  return `${NOTES_PATH}/${encodeURIComponent(id)}`;
}

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
      type: input.action === 'purge' || input.action === 'trash' ? 'note.deleted' : 'note.invalidated',
      noteId: item.id });
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
  async assistOutcome(id: string, input: NoteAssistOutcome): Promise<void> {
    await this.transport.request({ method: 'POST', path: `${notePath(id)}/assist/outcome`, body: input,
      schema: NoteAssistOutcomeViewSchema, what: '笔记建议的结果', lostAs: 'failed' });
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

  async importFiles(input: ImportNotesRequest): Promise<ImportNotesResponse> {
    const result = await this.transport.request({ method: 'POST', path: NOTES_IMPORT_PATH, body: input,
      schema: ImportNotesResponseSchema, what: '导入笔记', lostAs: 'uncertain', timeoutMs: TRANSFER_TIMEOUT_MS });
    this.local.emit({ type: 'note.invalidated', noteId: 'folders' });
    for (const note of result.imported) this.local.emit({ type: 'note.updated', note });
    return result;
  }

  async exportFiles(ids: readonly string[], signal?: AbortSignal): Promise<DownloadedFile> {
    return this.transport.download({ method: 'POST', path: NOTES_EXPORT_PATH, body: { ids }, what: '导出笔记',
      lostAs: 'failed', timeoutMs: TRANSFER_TIMEOUT_MS, signal }, '笔记.zip');
  }
}
