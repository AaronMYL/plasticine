// 假的文件页、云端浏览器、笔记版本：文件页是一棵内存里的树（路径不许出根、改名和删除要打名字、删除进回收能还原）；
// 浏览器开一个页面、做动作（假实现里动作算干跑，和开发期真服务端一样）。写操作按 requestId 幂等。

import type { FilesApi, NoteVersionsApi } from '../m5b-client.ts';
import { ApiError, ConflictError } from '../errors.ts';
import {
  type CreateFolderRequest,
  type FileEntryView,
  type FileListResponse,
  type MoveFileRequest,
  type NoteVersionListResponse,
  type NoteVersionText,
  type RestoreFileRequest,
  type TrashEntryView,
  type TrashFileRequest,
  type TrashListResponse,
  type UploadFileRequest,
  type WriteFileTextRequest,
} from '../shared.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeNotes } from './fake-notes.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export interface FakeWorkspaceDeps {
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  now: () => Date;
}

function invalid(message: string, field: string): ApiError {
  return new ApiError({ kind: 'invalid', code: 'invalid_request', message, field, status: 400 });
}

function notFound(what: string): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message: `没有找到${what}。`, status: 404 });
}

/** The same segment rules as the server (artifacts/workspace.ts). */
function checkPath(path: string, field = 'path'): string {
  if (path === '') {
    return '';
  }
  if (path.replace(/^\//, '').split('/').some((part) => part === '.' || part === '..')) {
    throw invalid('路径出了文件页的根目录。', field);
  }
  return path;
}

function parentOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function foldersFirst(a: FileEntryView, b: FileEntryView): number {
  if (a.kind !== b.kind) {
    return a.kind === 'directory' ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

export class FakeFiles implements FilesApi {
  private readonly contents = new Map<string, { text: string; version: string }>();
  private readonly entries = new Map<string, FileEntryView>();
  private readonly bin = new Map<string, TrashEntryView & { entry: FileEntryView }>();
  private readonly deps: FakeWorkspaceDeps;
  private sequence = 0;

  constructor(deps: FakeWorkspaceDeps) {
    this.deps = deps;
  }

  async list(path: string): Promise<FileListResponse> {
    this.deps.session.require();
    const folder = checkPath(path);
    if (folder !== '' && this.entries.get(folder)?.kind !== 'directory') {
      throw notFound(`「${folder}」`);
    }
    const entries = [...this.entries.values()]
      .filter((entry) => parentOf(entry.path) === folder)
      .sort(foldersFirst);
    return { path: folder, parent: folder === '' || folder === '/' ? null : parentOf(folder), entries,
      freeBytes: 32 * 1024 * 1024 * 1024 };
  }

  downloadUrl(path: string): string {
    return `/v2/files/content?path=${encodeURIComponent(path)}`;
  }

  async readText(path: string) {
    this.deps.session.require();
    if (!this.entries.has(path)) { throw notFound('这个文件'); }
    return { path, ...(this.contents.get(path) ?? { text: '', version: 'initial' }) };
  }

  async writeText(input: WriteFileTextRequest) {
    this.deps.session.require();
    return this.deps.receipts.run('files', input.requestId, 'PUT /v2/files/text', () => {
      const current = this.entries.has(input.path) ? this.contents.get(input.path)?.version ?? 'initial' : null;
      if (current !== input.version) {
        throw new ApiError({ kind: 'conflict', code: 'conflict', message: '文件已在别处修改，草稿仍保留。', status: 409 });
      }
      const content = { text: input.text, version: `file-${++this.sequence}` };
      this.contents.set(input.path, content);
      this.put(input.path, 'file', new TextEncoder().encode(input.text).byteLength);
      return { path: input.path, ...content };
    });
  }

  async upload(input: UploadFileRequest): Promise<FileEntryView> {
    this.deps.session.require();
    return this.deps.receipts.run('files', input.requestId, 'POST /v2/files/upload', () => {
      const path = checkPath(input.directory === '' ? input.name : `${input.directory}/${input.name}`);
      if (this.entries.has(path) && input.overwrite !== true) {
        throw new ApiError({ kind: 'failed', code: 'conflict', message: `这里已经有「${input.name}」了。`, status: 409 });
      }
      const bytes = Uint8Array.from(atob(input.contentBase64), (char) => char.charCodeAt(0));
      this.contents.set(path, { text: new TextDecoder().decode(bytes), version: `file-${++this.sequence}` });
      return this.put(path, 'file', bytes.length);
    });
  }

  async createFolder(input: CreateFolderRequest): Promise<FileEntryView> {
    this.deps.session.require();
    return this.deps.receipts.run('files', input.requestId, 'POST /v2/files/folders', () => {
      return this.put(checkPath(input.path), 'directory', 0);
    });
  }

  async move(input: MoveFileRequest): Promise<FileEntryView> {
    this.deps.session.require();
    return this.deps.receipts.run('files', input.requestId, 'POST /v2/files/move', () => {
      const entry = this.confirmed(checkPath(input.from, 'from'), input.confirmName);
      const to = checkPath(input.to, 'to');
      const content = this.contents.get(entry.path);
      if (content !== undefined) { this.contents.set(to, content); this.contents.delete(entry.path); }
      this.entries.delete(entry.path);
      return this.put(to, entry.kind, entry.bytes);
    });
  }

  async trash(input: TrashFileRequest): Promise<TrashEntryView> {
    this.deps.session.require();
    return this.deps.receipts.run('files', input.requestId, 'POST /v2/files/trash', () => {
      const entry = this.confirmed(checkPath(input.path), input.confirmName);
      this.sequence += 1;
      const id = `trash_${this.sequence}`;
      const trashed = { id, name: entry.name, originalPath: entry.path, trashedAt: this.deps.now().toISOString() };
      this.bin.set(id, { ...trashed, entry });
      this.entries.delete(entry.path);
      return trashed;
    });
  }

  trashDetails(id: string): { kind: 'file' | 'folder'; fileCount: number } {
    const held = this.bin.get(id);
    if (held === undefined) throw notFound('回收里的这一项');
    return { kind: held.entry.kind === 'directory' ? 'folder' : 'file', fileCount:
      [...this.entries.values()].filter((entry) => entry.kind === 'file'
        && entry.path.startsWith(`${held.originalPath}/`)).length };
  }

  purgeDeleted(id: string): void {
    this.deps.session.require();
    const held = this.bin.get(id);
    if (held === undefined) throw notFound('回收里的这一项');
    for (const path of this.entries.keys()) if (path.startsWith(`${held.originalPath}/`)) this.entries.delete(path);
    for (const path of this.contents.keys()) if (path === held.originalPath
      || path.startsWith(`${held.originalPath}/`)) this.contents.delete(path);
    this.bin.delete(id);
  }

  async trashed(): Promise<TrashListResponse> {
    this.deps.session.require();
    return { entries: [...this.bin.values()].map(({ entry: _entry, ...view }) => view) };
  }

  async restore(input: RestoreFileRequest): Promise<FileEntryView> {
    this.deps.session.require();
    return this.deps.receipts.run('files', input.requestId, 'POST /v2/files/restore', () => {
      const held = this.bin.get(input.id);
      if (held === undefined) {
        throw notFound('回收里的这一项');
      }
      this.bin.delete(input.id);
      return this.put(held.originalPath, held.entry.kind, held.entry.bytes);
    });
  }

  /** 本地开发：回收里先放一份。 */
  seedTrashed(path: string, trashedAt: string): void {
    const entry = this.put(path, 'file', 10);
    this.entries.delete(path);
    this.sequence += 1;
    const id = `trash_${this.sequence}`;
    this.bin.set(id, { id, name: entry.name, originalPath: entry.path, trashedAt, entry });
  }

  seed(path: string, kind: FileEntryView['kind'] = 'file', bytes = 10): FileEntryView {
    return this.put(path, kind, bytes);
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  private confirmed(path: string, confirmName: string): FileEntryView {
    const entry = this.entries.get(path);
    if (entry === undefined) {
      throw notFound(`「${path}」`);
    }
    if (confirmName !== entry.name) {
      throw invalid(`要打一遍「${entry.name}」确认，打的对不上，没有执行。`, 'confirmName');
    }
    return entry;
  }

  private put(path: string, kind: FileEntryView['kind'], bytes: number): FileEntryView {
    const entry: FileEntryView = {
      name: nameOf(path),
      path,
      kind,
      bytes,
      modifiedAt: this.deps.now().toISOString(),
      type: kind === 'file' ? 'application/octet-stream' : null,
    };
    this.entries.set(path, entry);
    return entry;
  }
}

export { FakeBrowser } from './fake-browser.ts';

export class FakeNoteVersions implements NoteVersionsApi {
  private readonly notes: FakeNotes;
  private readonly session: FakeSession;

  constructor(notes: FakeNotes, session: FakeSession) {
    this.notes = notes;
    this.session = session;
  }

  async versions(noteId: string): Promise<NoteVersionListResponse> {
    this.session.require();
    await this.notes.get(noteId);
    const versions = this.notes.versions(noteId).map((note) => ({
      version: note.version, bytes: note.bytes, characters: Array.from(note.markdown).length,
      author: note.author, savedAt: note.updatedAt,
    }));
    return { versions };
  }

  async version(noteId: string, version: number): Promise<NoteVersionText> {
    this.session.require();
    await this.notes.get(noteId);
    const note = this.notes.versions(noteId).find((row) => row.version === version);
    if (note === undefined) {
      throw notFound('这一版');
    }
    return { version, bytes: note.bytes, characters: Array.from(note.markdown).length,
      author: note.author, savedAt: note.updatedAt, markdown: note.markdown };
  }
}
