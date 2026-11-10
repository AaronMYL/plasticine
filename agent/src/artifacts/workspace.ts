// 文件页：相对路径从状态目录 files/ 开始，绝对路径访问服务进程可读写的服务器位置。
// 文本编辑核对内容版本；符号链接编辑其目标，改名 / 移动 / 回收则操作链接本身。
// 删除不真删：挪进同在状态目录里的 files-trash/，可以还原（不删任何现有数据）；永久删除这一版不做。

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { WORKSPACE_PATH_MAX_CHARS } from '../../shared/state.ts';
import { ArtifactError } from './errors.ts';
import { checkUpload, contentTypeOf } from './file-types.ts';

export const FILES_DIRECTORY = 'files';
export const TRASH_DIRECTORY = 'files-trash';
// 1ca0391 files.ts：上传最多 20 MB。
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
// 下载整份读进内存再发；50 MB 以上的不在这一版的文件页里下载。
export const DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const NAME_MAX_CHARS = 255;
// 只有服务进程自己能读写。
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const BAD_SEGMENT = /[\\:\0]|^\.{1,2}$/;
const TRASH_ID = /^[0-9a-f-]{36}$/;

export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory' | 'other';
  bytes: number;
  modifiedAt: string;
  type: string | null;
}

export interface TrashEntry {
  id: string;
  name: string;
  originalPath: string;
  trashedAt: string;
  kind?: 'file' | 'folder';
  fileCount?: number;
  purgingAt?: string;
}

const TrashMetaSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  originalPath: Type.String({ minLength: 1 }),
  trashedAt: Type.String({ minLength: 1 }),
  kind: Type.Optional(Type.Enum(['file', 'folder'])),
  fileCount: Type.Optional(Type.Integer({ minimum: 0 })),
  purgingAt: Type.Optional(Type.String({ minLength: 1 })),
});

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** `a/b/c` → its segments, each checked; '' and '.' are the root. */
export function pathSegments(path: string, field = 'path'): string[] {
  if (path.length > WORKSPACE_PATH_MAX_CHARS) {
    throw new ArtifactError('invalid_input', '路径太长了。', field);
  }
  if (path === '' || path === '.') {
    return [];
  }
  if (path.startsWith('/')) {
    throw new ArtifactError('invalid_input', '路径要相对于文件页的根目录写，不能以 / 开头。', field);
  }
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '' || BAD_SEGMENT.test(segment) || segment.length > NAME_MAX_CHARS) {
      throw new ArtifactError('invalid_input', `路径里有不能用的一段「${segment}」。`, field);
    }
  }
  return segments;
}

export function checkName(name: string, field = 'name'): string {
  const segments = pathSegments(name, field);
  if (segments.length !== 1) {
    throw new ArtifactError('invalid_input', '名字里不能有 /。', field);
  }
  return name;
}

function kindOf(stats: Stats): WorkspaceEntry['kind'] {
  if (stats.isFile()) {
    return 'file';
  }
  return stats.isDirectory() ? 'directory' : 'other';
}

/** Folders first, then by name. */
function foldersFirst(a: WorkspaceEntry, b: WorkspaceEntry): number {
  if (a.kind !== b.kind && (a.kind === 'directory' || b.kind === 'directory')) {
    return a.kind === 'directory' ? -1 : 1;
  }
  return a.name.localeCompare(b.name, 'zh-CN');
}

export class Workspace {
  readonly #root: string;
  readonly #trash: string;
  readonly #now: () => Date;

  constructor(stateDirectory: string, now: () => Date) {
    this.#root = resolve(stateDirectory, FILES_DIRECTORY);
    this.#trash = resolve(stateDirectory, TRASH_DIRECTORY);
    this.#now = now;
  }

  list(path: string): { path: string; parent: string | null; entries: WorkspaceEntry[]; freeBytes: number } {
    const absolute = this.#resolve(path);
    this.#ensureRoot();
    const stats = this.#stat(absolute, path);
    if (!stats.isDirectory()) {
      throw new ArtifactError('invalid_input', '这不是一个文件夹。', 'path');
    }
    const entries = readdirSync(absolute).map((name) => this.#entry(join(absolute, name)));
    entries.sort(foldersFirst);
    const clean = this.#relative(absolute);
    const disk = statfsSync(absolute);
    return { path: clean, parent: clean === '' || absolute === '/' ? null : this.#relative(dirname(absolute)), entries,
      freeBytes: disk.bavail * disk.bsize };
  }

  stat(path: string): WorkspaceEntry {
    const absolute = this.#resolve(path);
    this.#stat(absolute, path);
    return this.#entry(absolute);
  }

  /** The whole file, for a download or an artifact's content. */
  read(path: string): { data: Buffer; entry: WorkspaceEntry } {
    const entry = this.stat(path);
    if (entry.kind !== 'file') {
      throw new ArtifactError('invalid_input', '这不是一个文件。', 'path');
    }
    if (entry.bytes > DOWNLOAD_MAX_BYTES) {
      throw new ArtifactError('too_large', `文件超过 ${DOWNLOAD_MAX_BYTES / 1024 / 1024} MB，这一版不在这里下载。`, 'path');
    }
    return { data: readFileSync(this.#resolve(path)), entry };
  }

  readText(path: string): { path: string; text: string; version: string } {
    const { data, entry } = this.read(path);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { throw new ArtifactError('unsupported_type', '这不是 UTF-8 文本，请下载后打开。', 'path'); }
    if (text.includes('\0')) { throw new ArtifactError('unsupported_type', '这个文件是二进制内容，请下载后打开。'); }
    return { path: entry.path, text, version: createHash('sha256').update(data).digest('hex') };
  }

  writeText(path: string, text: string, version: string | null): { path: string; text: string; version: string } {
    const absolute = this.#resolve(path);
    this.#ensureRoot();
    const present = existsSync(absolute);
    const current = present ? this.readText(path).version : null;
    if (current !== version) { throw new ArtifactError('conflict', '文件已在别处修改。请读取新版对照，草稿仍保留。'); }
    const target = present ? realpathSync(absolute) : absolute;
    const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.edit`);
    writeFileSync(temp, text, { mode: present ? statSync(target).mode : FILE_MODE, flag: 'wx' });
    renameSync(temp, target);
    return this.readText(path);
  }

  upload(directory: string, name: string, data: Buffer, overwrite: boolean): WorkspaceEntry {
    checkName(name);
    if (data.length > UPLOAD_MAX_BYTES) {
      throw new ArtifactError('too_large', `一个文件最多 ${UPLOAD_MAX_BYTES / 1024 / 1024} MB。`, 'content');
    }
    checkUpload(name, data);
    const folder = this.#resolve(directory);
    this.#ensureRoot();
    if (!this.#stat(folder, directory).isDirectory()) {
      throw new ArtifactError('invalid_input', '要放进的不是一个文件夹。', 'directory');
    }
    const target = join(folder, name);
    if (existsSync(target) && (!overwrite || !statSync(target).isFile())) {
      throw new ArtifactError('conflict', `这里已经有「${name}」了。`, 'name');
    }
    const temp = join(folder, `.${name}.${randomUUID()}.upload`);
    writeFileSync(temp, data, { mode: FILE_MODE, flag: 'wx' });
    renameSync(temp, target);
    return this.#entry(target);
  }

  mkdir(path: string): WorkspaceEntry {
    const absolute = this.#resolve(path);
    if (absolute === this.#root) {
      throw new ArtifactError('invalid_input', '根目录已经在了。', 'path');
    }
    this.#ensureRoot();
    if (existsSync(absolute)) {
      throw new ArtifactError('conflict', '这里已经有同名的了。', 'path');
    }
    if (!this.#stat(dirname(absolute), path).isDirectory()) {
      throw new ArtifactError('invalid_input', '上一级不是文件夹。', 'path');
    }
    mkdirSync(absolute, { mode: DIRECTORY_MODE });
    return this.#entry(absolute);
  }

  /** Renames or moves; the user typed the current name to confirm. */
  move(from: string, to: string, confirmName: string): WorkspaceEntry {
    const source = this.#resolve(from, 'from');
    const target = this.#resolve(to, 'to');
    this.#confirm(source, confirmName);
    if (existsSync(target)) {
      throw new ArtifactError('conflict', '目标位置已经有同名的了。', 'to');
    }
    if (target.startsWith(`${source}${sep}`)) {
      throw new ArtifactError('invalid_input', '不能把文件夹移进它自己里面。', 'to');
    }
    if (!this.#stat(dirname(target), to).isDirectory()) {
      throw new ArtifactError('invalid_input', '目标的上一级不是文件夹。', 'to');
    }
    renameSync(source, target);
    return this.#entry(target);
  }

  /** Moves into files-trash/ (restorable); the user typed the name to confirm. */
  trash(path: string, confirmName: string): TrashEntry {
    const source = this.#resolve(path);
    this.#confirm(source, confirmName);
    const id = randomUUID();
    const holder = join(this.#trash, id);
    mkdirSync(holder, { recursive: true, mode: DIRECTORY_MODE });
    const entry: TrashEntry = {
      id,
      name: basename(source),
      originalPath: this.#relative(source),
      trashedAt: this.#now().toISOString(),
    };
    writeFileSync(join(this.#trash, `${id}.json`), JSON.stringify(entry), { mode: FILE_MODE, flag: 'wx' });
    renameSync(source, join(holder, entry.name));
    return entry;
  }

  trashed(): TrashEntry[] {
    if (!existsSync(this.#trash)) {
      return [];
    }
    return readdirSync(this.#trash)
      .filter((name) => name.endsWith('.json') && TRASH_ID.test(name.slice(0, -'.json'.length)))
      .map((name) => this.#trashEntry(name.slice(0, -'.json'.length)))
      .filter((entry) => entry !== undefined
        && (entry.purgingAt !== undefined || existsSync(join(this.#trash, entry.id, entry.name))))
      .map((entry) => entry as TrashEntry)
      .sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
  }

  restore(id: string): WorkspaceEntry {
    const entry = TRASH_ID.test(id) ? this.#trashEntry(id) : undefined;
    const held = entry === undefined ? undefined : join(this.#trash, id, entry.name);
    if (entry === undefined || held === undefined || !existsSync(held)) {
      throw new ArtifactError('not_found', '回收里没有这一项了。', 'id');
    }
    if (entry.purgingAt !== undefined) {
      throw new ArtifactError('conflict', '这一项已开始永久删除，请重试永久删除完成清理。', 'id');
    }
    const target = this.#resolve(entry.originalPath);
    if (existsSync(target)) {
      throw new ArtifactError('conflict', `原来的位置已经有「${entry.name}」了，没有还原。`, 'id');
    }
    mkdirSync(dirname(target), { recursive: true, mode: DIRECTORY_MODE });
    renameSync(held, target);
    return this.#entry(target);
  }

  /** 最近删除中的清空例外：只删除回收目录，不跟随目录里的符号链接。 */
  purge(id: string): void {
    if (!TRASH_ID.test(id)) { throw new ArtifactError('not_found', '回收里没有这一项了。', 'id'); }
    const meta = join(this.#trash, `${id}.json`);
    if (!existsSync(meta)) { throw new ArtifactError('not_found', '回收里没有这一项了。', 'id'); }
    const raw: unknown = JSON.parse(readFileSync(meta, 'utf8'));
    if (typeof raw === 'object' && raw !== null && 'purgedAt' in raw && typeof raw.purgedAt === 'string') { return; }
    const entry = this.#trashEntry(id);
    const held = join(this.#trash, id);
    if (entry === undefined || (!existsSync(held) && entry.purgingAt === undefined)) {
      throw new ArtifactError('not_found', '回收里没有这一项了。', 'id');
    }
    if (entry.purgingAt === undefined) {
      const details = this.trashDetails(id);
      writeFileSync(meta, JSON.stringify({ ...entry, ...details, purgingAt: this.#now().toISOString() }),
        { mode: FILE_MODE });
    }
    rmSync(held, { recursive: true, force: true });
    writeFileSync(meta, JSON.stringify({ id, trashedAt: entry.trashedAt, purgedAt: this.#now().toISOString() }),
      { mode: FILE_MODE });
  }

  trashDetails(id: string): { kind: 'file' | 'folder'; fileCount: number } {
    const entry = TRASH_ID.test(id) ? this.#trashEntry(id) : undefined;
    if (entry === undefined || basename(entry.name) !== entry.name) {
      throw new ArtifactError('not_found', '回收里没有这一项了。', 'id');
    }
    const held = join(this.#trash, id, entry.name);
    if (entry.purgingAt !== undefined && entry.kind !== undefined && entry.fileCount !== undefined) {
      return { kind: entry.kind, fileCount: entry.fileCount };
    }
    const count = (path: string): number => {
      const stats = lstatSync(path);
      return stats.isDirectory() ? readdirSync(path).reduce((total, name) => total + count(join(path, name)), 0) : 1;
    };
    return { kind: lstatSync(held).isDirectory() ? 'folder' : 'file', fileCount: count(held) };
  }

  #trashEntry(id: string): TrashEntry | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(this.#trash, `${id}.json`), 'utf8'));
      return Value.Check(TrashMetaSchema, parsed) ? { id, ...parsed } : undefined;
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) {
        return undefined;
      }
      throw error;
    }
  }

  #confirm(absolute: string, confirmName: string): void {
    if (absolute === this.#root) {
      throw new ArtifactError('invalid_input', '根目录不能改名、移动或删除。', 'path');
    }
    this.#stat(absolute, this.#relative(absolute));
    if (confirmName !== basename(absolute)) {
      throw new ArtifactError('invalid_input', `要打一遍「${basename(absolute)}」确认，打的对不上，没有执行。`, 'confirmName');
    }
  }

  #ensureRoot(): void {
    mkdirSync(this.#root, { recursive: true, mode: DIRECTORY_MODE });
  }

  /** The absolute path inside files/, refused when it would leave it (also through a symbolic link). */
  #resolve(path: string, field = 'path'): string {
    if (isAbsolute(path)) {
      if (path.length > WORKSPACE_PATH_MAX_CHARS || path.includes('\0')) {
        throw new ArtifactError('invalid_input', '路径长度或字符不正确。', field);
      }
      return resolve(path);
    }
    const absolute = resolve(this.#root, ...pathSegments(path, field));
    if (absolute !== this.#root && !absolute.startsWith(`${this.#root}${sep}`)) {
      throw new ArtifactError('invalid_input', '路径出了文件页的根目录。', field);
    }
    return absolute;
  }

  #relative(absolute: string): string {
    if (absolute !== this.#root && !absolute.startsWith(`${this.#root}${sep}`)) { return absolute; }
    return relative(this.#root, absolute).split(sep).join('/');
  }

  #stat(absolute: string, shown: string): Stats {
    try {
      return statSync(absolute);
    } catch (error) {
      if (isMissing(error)) {
        throw new ArtifactError('not_found', `没有「${shown || '/'}」。`, 'path');
      }
      throw error;
    }
  }

  #entry(absolute: string): WorkspaceEntry {
    const stats = statSync(absolute);
    const kind = kindOf(stats);
    return {
      name: basename(absolute),
      path: this.#relative(absolute),
      kind,
      bytes: stats.isFile() ? stats.size : 0,
      modifiedAt: stats.mtime.toISOString(),
      type: kind === 'file' ? contentTypeOf(basename(absolute)) : null,
    };
  }
}
