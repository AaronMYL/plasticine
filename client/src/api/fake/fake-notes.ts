import { FakeBatchReceipts, fakeBatch, checkTrashCount } from './fake-batch.ts';
import { createRequestId } from '../request-id.ts';
import {
  DEFAULT_NOTE_FOLDER, NOTE_IMAGE_MAX_BYTES, type EmptyTrashRequest, type NoteAssistOutcome, type NoteAssistRequest,
  type NoteAssistView, type NoteFolderCommand, type NoteFoldersView, type NoteImageRequest, type NoteImageView,
  type ImportNotesRequest, type ImportNotesResponse, type NoteImportView, type NotesBatchRequest,
  type NoteSupplement,
} from '../shared.ts';
import type { DownloadedFile, NotesApi } from '../client.ts';
import { ApiError, NoteConflictError } from '../errors.ts';
import type { CreateNoteRequest, NoteMetaView, NoteSearch, NoteView, SaveNoteRequest } from '../types.ts';
import { toMeta } from '../note-meta.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import { faultError, type FaultPlan } from './faults.ts';
import { fakeExportFile, fakeImportDraft } from './fake-note-transfer.ts';
import { noteBytes, notePreview, noteTitle } from './note-text.ts';

export interface FakeNotesDeps {
  session: FakeSession;
  bus: FakeEventBus;
  faults: FaultPlan;
  now: () => Date;
}

const FAKE_DELTA_CHARS = 2;

type NoteIdentity = Omit<NoteView, 'title' | 'preview' | 'bytes' | 'markdown' | 'updatedAt'>;

type NotePatch = Partial<Pick<NoteView, 'markdown' | 'folder' | 'pinned'>>;

export type NoteSeed = Pick<NoteView, 'id' | 'markdown'> &
  Partial<Omit<NoteView, 'id' | 'markdown' | 'title' | 'preview' | 'bytes'>>;

export class FakeNotes implements NotesApi {
  backupSnapshots(): NoteView[] { return structuredClone([...this.notes.values()]); }
  private readonly notes = new Map<string, NoteView>();
  private readonly results = new Map<string, NoteView>();
  private readonly folderResults = new Map<string, NoteFoldersView>();
  private readonly importResults = new Map<string, ImportNotesResponse>();
  private readonly deps: FakeNotesDeps;
  private sequence = 0;
  private readonly history = new Map<string, Map<number, NoteView>>();
  private folderOrder = [DEFAULT_NOTE_FOLDER];
  readonly importViews = new Map<string, NoteImportView>();

  unlock(id: string): void {
    this.requireAccess(id);
  }

  private requireAccess(id: string): void {
    this.deps.session.require();
    this.find(id);
  }

  versions(id: string): NoteView[] {
    this.find(id);
    return [...(this.history.get(id)?.values() ?? [])].sort((a, b) => b.version - a.version);
  }

  private remember(note: NoteView): void {
    const history = this.history.get(note.id) ?? new Map<number, NoteView>();
    history.set(note.version, note);
    this.history.set(note.id, history);
  }

  constructor(deps: FakeNotesDeps) {
    this.deps = deps;
  }

  private readonly batchReceipts = new FakeBatchReceipts();

  async batch(input: NotesBatchRequest) {
    this.deps.session.require();
    return this.batchReceipts.run(input, () => fakeBatch(input.items, async (item) => this.find(item.id).title,
      async (item) => {
        const note = this.find(item.id);
        const requestId = createRequestId();
        switch (input.action) {
          case 'move': return this.save(item.id, { requestId, version: note.version, folder: input.destination ?? '' });
          case 'trash': return this.remove(item.id, requestId);
          case 'restore': return this.restore(item.id, requestId);
          case 'purge': return this.purgeDeleted(item.id);
        }
      }));
  }

  async emptyTrash(input: EmptyTrashRequest) {
    this.deps.session.require();
    return this.batchReceipts.run(input, async () => {
      const rows = await this.list({ deletedOnly: true });
      checkTrashCount(rows.length, input.expectCount);
      return fakeBatch(rows.map((row) => ({ kind: 'note', id: row.id })), async (item) => this.find(item.id).title,
        async (item) => this.purgeDeleted(item.id));
    });
  }

  private purgeDeleted(id: string): void {
    if (this.find(id).deletedAt === null) throw new Error('先移到最近删除，再永久删除。');
    this.notes.delete(id);
    this.history.delete(id);
    this.importViews.delete(id);
    this.deps.bus.emit({ type: 'note.deleted', noteId: id });
  }

  async list(query: NoteSearch): Promise<NoteMetaView[]> {
    this.deps.session.require();
    return [...this.notes.values()]
      .filter((note) => query.deletedOnly ? note.deletedAt !== null : query.includeDeleted || note.deletedAt === null)
      .filter((note) => query.folder === undefined || note.folder === query.folder)
      .filter((note) => !query.q?.trim()
        || note.markdown.toLocaleLowerCase().includes(query.q.trim().toLocaleLowerCase()))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
      .map(toMeta);
  }

  async folders(): Promise<NoteFoldersView> {
    this.deps.session.require();
    for (const note of this.notes.values()) {
      if (!this.folderOrder.includes(note.folder) && note.folder !== '已合并（原版）') {
        this.folderOrder.push(note.folder);
      }
    }
    const live = [...this.notes.values()].filter((note) => note.deletedAt === null);
    return { folders: this.folderOrder.map((name) => ({ name, fixed: name === DEFAULT_NOTE_FOLDER,
      count: live.filter((note) => note.folder === name).length })), allCount: live.length,
    deletedCount: this.notes.size - live.length, mergedCount: live.filter((n) => n.folder === '已合并（原版）').length };
  }
  async changeFolder(input: NoteFolderCommand): Promise<NoteFoldersView> {
    this.deps.session.require();
    const prior = this.folderResults.get(input.requestId);
    if (prior !== undefined) { return prior; }
    await this.folders();
    const fail = (message: string): never => {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', message, status: 400 });
    };
    if (input.action === 'create') {
      if (this.folderOrder.includes(input.name)) { fail('已有同名文件夹。'); }
      this.folderOrder.push(input.name);
    } else {
      if (input.name === DEFAULT_NOTE_FOLDER) { fail('固定文件夹不能修改。'); }
      const index = this.folderOrder.indexOf(input.name);
      if (input.action === 'move') {
        const next = index + input.direction;
        if (next > 0 && next < this.folderOrder.length) {
          [this.folderOrder[index], this.folderOrder[next]] = [this.folderOrder[next]!, this.folderOrder[index]!];
        }
      } else {
        const destination = input.action === 'rename' ? input.next : input.destination;
        if (input.action === 'rename' && this.folderOrder.includes(destination)) { fail('已有同名文件夹。'); }
        if (input.action === 'remove' && (destination === input.name || !this.folderOrder.includes(destination))) {
          fail('请选择别的文件夹。');
        }
        for (const note of this.notes.values()) {
          if (note.folder === input.name) { this.write(note, { folder: destination }, false); }
        }
        this.folderOrder.splice(index, 1, ...(input.action === 'rename' ? [destination] : []));
      }
    }
    this.deps.bus.emit({ type: 'note.invalidated', noteId: 'folders' });
    const response = await this.folders();
    this.folderResults.set(input.requestId, response);
    return response;
  }
  async restore(id: string, requestId: string): Promise<NoteView> {
    this.requireAccess(id);
    const previous = this.results.get(requestId);
    if (previous !== undefined) { return previous; }
    const note = this.find(id);
    const restored = note.deletedAt === null ? note : this.write({ ...note, deletedAt: null }, {});
    this.results.set(requestId, restored);
    return restored;
  }
  async uploadImage(id: string, input: NoteImageRequest): Promise<NoteImageView> {
    this.requireAccess(id);
    const bytes = atob(input.data).length;
    if (bytes > NOTE_IMAGE_MAX_BYTES) { throw new Error('图片不能超过 10 MB。'); }
    return { url: `/v2/notes/assets/${input.requestId}.png`, bytes };
  }
  async assist(id: string, input: NoteAssistRequest, signal?: AbortSignal): Promise<NoteAssistView> {
    this.requireAccess(id);
    signal?.throwIfAborted();
    const related = [...this.notes.values()].find((note) => note.id !== id && note.deletedAt === null);
    if (input.action === 'interject') return { markdown: '', label: '补充建议', suggestions: this.withLoopIds([
      { kind: 'structure', text: '把经过与想法分成两节', draft: `## 经过\n\n${input.selected ?? input.markdown}` },
      { kind: 'supplement', text: '补上需要核实的时间', draft: '具体时间：[待确认]。' },
      { kind: 'example', text: '用一个已有的例子说明', draft: '例如，可以补上已经记录过的那次尝试。' },
      ...(related === undefined ? [] : [{ kind: 'contact' as const, text: `关联《${related.title}》`,
        draft: '也可以参照已有记录，再核对这次的变化。',
        reference: { kind: 'note' as const, id: related.id, label: related.title } }]),
    ]) };
    const markdown = input.action === 'predict' ? '，再想一步。'
      : `${input.selected ?? input.markdown}\n\n整理后的补充。`;
    return input.action === 'predict' ? { markdown, label: '修改建议', loopId: this.nextLoopId() }
      : { markdown, label: '修改建议' };
  }
  private loopSeq = 0;
  private nextLoopId(): string {
    this.loopSeq += 1;
    return `fake-loop-${this.loopSeq}`;
  }
  private withLoopIds(items: NoteSupplement[]): NoteSupplement[] {
    return items.map((item) => ({ ...item, loopId: this.nextLoopId() }));
  }
  readonly outcomes: NoteAssistOutcome[] = [];
  async assistOutcome(id: string, input: NoteAssistOutcome): Promise<void> {
    this.requireAccess(id);
    this.outcomes.push(input);
  }
  async assistStream(id: string, input: NoteAssistRequest, onText: (delta: string) => void,
    signal?: AbortSignal): Promise<NoteAssistView> {
    const view = await this.assist(id, input, signal);
    for (let start = 0; start < view.markdown.length; start += FAKE_DELTA_CHARS) {
      await Promise.resolve();
      signal?.throwIfAborted();
      onText(view.markdown.slice(start, start + FAKE_DELTA_CHARS));
    }
    return view;
  }
  async imported(id: string): Promise<NoteImportView> {
    this.requireAccess(id);
    return this.importViews.get(id) ?? { variants: [], mergedInto: null, originalIds: [], links: [] };
  }

  async get(id: string): Promise<NoteView> {
    this.deps.session.require();
    this.requireAccess(id);
    const fault = this.deps.faults.take('get');
    if (fault !== undefined) {
      throw faultError('get', fault);
    }
    return this.find(id);
  }

  async create(input: CreateNoteRequest): Promise<NoteView> {
    this.deps.session.require();
    const fault = this.deps.faults.take('create');
    if (fault !== undefined && (fault.kind === 'failed' || !fault.landed)) {
      throw faultError('create', fault);
    }
    const replay = this.results.get(input.requestId);
    if (replay !== undefined) {
      return replay;
    }
    const at = this.deps.now().toISOString();
    this.sequence += 1;
    const id = `note_${String(this.sequence).padStart(4, '0')}`;
    const folder = input.folder === undefined ? {} : { folder: input.folder };
    const note = this.write(this.identity({ id, createdAt: at }, 0), { markdown: input.markdown, ...folder });
    this.results.set(input.requestId, note);
    if (fault !== undefined) {
      throw faultError('create', fault);
    }
    return note;
  }

  async save(id: string, input: SaveNoteRequest): Promise<NoteView> {
    this.deps.session.require();
    this.requireAccess(id);
    const fault = this.deps.faults.take('save');
    if (fault !== undefined && (fault.kind === 'failed' || !fault.landed)) {
      throw faultError('save', fault);
    }
    const replay = this.results.get(input.requestId);
    if (replay !== undefined) {
      return replay;
    }
    const stored = this.find(id);
    if (stored.readOnly && (input.markdown !== undefined || input.folder !== undefined)) {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', message: '这篇笔记是只读的。', status: 400 });
    }
    if (stored.version !== input.version) {
      throw new NoteConflictError(stored);
    }
    const patch: NotePatch = {};
    if (input.markdown !== undefined) {
      patch.markdown = input.markdown;
    }
    if (input.folder !== undefined) {
      patch.folder = input.folder;
    }
    if (input.pinned !== undefined) {
      patch.pinned = input.pinned;
    }
    const note = this.write({ ...stored, author: 'user' }, patch);
    this.results.set(input.requestId, note);
    if (fault !== undefined) {
      throw faultError('save', fault);
    }
    return note;
  }

  async remove(id: string, requestId: string): Promise<NoteView> {
    this.deps.session.require();
    const fault = this.deps.faults.take('remove');
    if (fault !== undefined && (fault.kind === 'failed' || !fault.landed)) {
      throw faultError('remove', fault);
    }
    const replay = this.results.get(requestId);
    if (replay !== undefined) {
      return replay;
    }
    const stored = this.find(id);
    const deleted = stored.deletedAt === null
      ? this.write({ ...stored, deletedAt: this.deps.now().toISOString() }, {}) : stored;
    this.results.set(requestId, deleted);
    this.deps.bus.emit({ type: 'note.deleted', noteId: id });
    if (fault !== undefined) {
      throw faultError('remove', fault);
    }
    return deleted;
  }

  seed(seed: NoteSeed): void {
    const at = this.deps.now().toISOString();
    const base = this.identity({ createdAt: at, ...seed }, seed.version ?? 1);
    this.notes.set(seed.id, this.computed({ ...base, markdown: seed.markdown, updatedAt: seed.updatedAt ?? at }));
    this.remember(this.find(seed.id));
  }

  externalEdit(id: string, markdown: string, author: 'user' | 'ai' = 'user'): NoteView {
    return this.write({ ...this.find(id), author }, { markdown });
  }

  peek(id: string): { title: string; markdown: string } | undefined {
    const note = this.notes.get(id);
    return note === undefined ? undefined : { title: note.title, markdown: note.markdown };
  }

  async importFiles(input: ImportNotesRequest): Promise<ImportNotesResponse> {
    this.deps.session.require();
    const replay = this.importResults.get(input.requestId);
    if (replay !== undefined) { return replay; }
    const result: ImportNotesResponse = { imported: [], skipped: [] };
    for (const file of input.files) {
      const draft = fakeImportDraft(file);
      if ('reason' in draft) {
        result.skipped.push({ name: file.name, reason: draft.reason });
        continue;
      }
      this.sequence += 1;
      const id = `note_${String(this.sequence).padStart(4, '0')}`;
      const identity = this.identity({ id, createdAt: this.deps.now().toISOString(),
        folder: input.folder ?? DEFAULT_NOTE_FOLDER }, 0);
      result.imported.push(toMeta(this.write(identity, { markdown: draft.markdown })));
    }
    this.importResults.set(input.requestId, result);
    return result;
  }

  async exportFiles(ids: readonly string[]): Promise<DownloadedFile> {
    this.deps.session.require();
    return fakeExportFile(ids.map((id) => this.find(id)));
  }

  private find(id: string): NoteView {
    const note = this.notes.get(id);
    if (note === undefined) {
      throw new ApiError({
        kind: 'not_found',
        code: 'not_found',
        message: '没有找到这篇笔记。',
        next: '刷新列表后再试。',
        status: 404,
      });
    }
    return note;
  }

  private identity(given: Pick<NoteView, 'id' | 'createdAt'> & Partial<NoteIdentity>, version: number): NoteIdentity {
    return {
      folder: DEFAULT_NOTE_FOLDER,
      pinned: false,
      readOnly: false,
      author: 'user',
      deletedAt: null,
      migrated: false,
      ...given,
      version,
    };
  }

  private computed(note: NoteIdentity & Pick<NoteView, 'markdown' | 'updatedAt'>): NoteView {
    return {
      ...note,
      title: noteTitle(note.markdown),
      preview: notePreview(note.markdown),
      bytes: noteBytes(note.markdown),
    };
  }

  private write(base: NoteIdentity & Partial<NoteView>, patch: NotePatch, publish = true): NoteView {
    const stored = this.computed({
      ...base,
      ...patch,
      markdown: patch.markdown ?? base.markdown ?? '',
      version: base.version + 1,
      updatedAt: this.deps.now().toISOString(),
    });
    this.notes.set(stored.id, stored);
    this.remember(stored);
    if (publish) { this.deps.bus.emit({ type: 'note.updated', note: toMeta(stored) }); }
    return stored;
  }
}
