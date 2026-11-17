// 设置 · 系统「数据迁移」的服务这一头（11-16）：一次一份导出、一次一份导入。
// 导出在后台打包，好了留 24 小时；导入分块收文件 → 读文件头 → 加了密的等口令（钥匙只在内存里）→ 后台解进暂存 →
// 他选合并或替换 → 写 pending.json、请服务重启，开库前由 apply.ts 做完。退回同样写 pending、重启。
// 口令不落盘、不进日志；导出的文件和暂存目录都只有服务用户能读。

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MIGRATION_BEFORE_KEEP_MS, MIGRATION_EXPORT_KEEP_MS, MIGRATION_FILE_EXTENSION,
  type MigrationExportView, type MigrationHow, type MigrationImportView, type MigrationMode, type MigrationStatus,
  type MigrationSummary,
} from '../../../shared/api/migration.ts';
import { errorCategory, safeLog } from '../../util/index.ts';
import { readBefore, readPending, readResult, writePending } from './apply.ts';
import { deriveKey, MigrationFileError, readHeader } from './format.ts';
import {
  EXPORTS_DIRECTORY, IMPORT_META_FILE, IMPORTS_DIRECTORY, MIGRATION_DIRECTORY, STAGED_DIRECTORY, UPLOAD_FILE,
} from './layout.ts';
import { packState } from './pack.ts';
import { readSummary, stageArchive, TooNewError } from './unpack.ts';
import { cleanupMigration } from './cleanup.ts';

/** 结果提示报多久。 */
const RESULT_SHOWN_MS = 60 * 60 * 1000;
/** 磁盘至少留这么多余量。 */
const DISK_SPARE = 200 * 1024 * 1024;

export class MigrationProblem extends Error {
  readonly code: 'busy' | 'no_space' | 'not_ready' | 'bad_request' | 'wrong_passphrase';
  constructor(code: MigrationProblem['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export interface MigrationServiceOptions {
  stateDirectory: string;
  now: () => Date;
  /** 把运行中的库一致地复制到 path。 */
  snapshot: (path: string) => void;
  /** 选好以后请服务重启（退出码 75，看护的会再拉起来）。 */
  restart: () => void;
  /** 测试把磁盘余量钉住。 */
  diskFree?: () => number;
}

interface ExportJob {
  view: MigrationExportView;
  path: string | null;
  abort: AbortController;
  requestId: string;
}

interface ImportJob {
  view: MigrationImportView;
  requestId: string;
  key: Buffer | null;
  abort: AbortController | null;
  createdAt: string;
}

function stamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function safeName(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'plasticine';
}

export class MigrationService {
  readonly #options: MigrationServiceOptions;
  readonly #root: string;
  #export: ExportJob | null = null;
  #import: ImportJob | null = null;

  constructor(options: MigrationServiceOptions) {
    this.#options = options;
    this.#root = join(options.stateDirectory, MIGRATION_DIRECTORY);
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    cleanupMigration(options.stateDirectory, options.now());
    this.#export = this.#loadExport();
    this.#import = this.#loadImport();
  }

  #diskFree(): number {
    if (this.#options.diskFree !== undefined) {
      return this.#options.diskFree();
    }
    const disk = statfsSync(this.#options.stateDirectory);
    return disk.bavail * disk.bsize;
  }

  status(): MigrationStatus {
    const now = this.#options.now();
    const before = readBefore(this.#options.stateDirectory);
    const result = readResult(this.#options.stateDirectory);
    const fresh = result !== null && now.getTime() - Date.parse(result.at) < RESULT_SHOWN_MS;
    return {
      export: this.#export === null ? null : { ...this.#export.view },
      import: this.#import === null ? null : { ...this.#import.view },
      before: before === null ? null : {
        id: before.id, how: before.meta.how, at: before.meta.at,
        expiresAt: new Date(Date.parse(before.meta.at) + MIGRATION_BEFORE_KEEP_MS).toISOString(),
      },
      result: fresh ? result : null,
      diskFreeBytes: Math.max(0, Math.floor(this.#diskFree())),
    };
  }

  // ---- 导出 ----

  #loadExport(): ExportJob | null {
    const root = join(this.#root, EXPORTS_DIRECTORY);
    if (!existsSync(root)) {
      return null;
    }
    for (const id of readdirSync(root)) {
      try {
        const view = JSON.parse(readFileSync(join(root, id, 'export.json'), 'utf8')) as MigrationExportView;
        if (view.state === 'ready' && view.fileName !== null) {
          return { view, path: join(root, id, view.fileName), abort: new AbortController(), requestId: '' };
        }
      } catch {
        rmSync(join(root, id), { recursive: true, force: true });
      }
    }
    return null;
  }

  startExport(requestId: string, mode: MigrationMode, passphrase: string | null): MigrationStatus {
    if (this.#export?.requestId === requestId) {
      return this.status();
    }
    if (this.#export?.view.state === 'running') {
      throw new MigrationProblem('busy', '上一份还在打包，等它好了或者先取消。');
    }
    if ((mode === 'full') !== (passphrase !== null)) {
      throw new MigrationProblem('bad_request', mode === 'full' ? '全部导出要设口令。' : '只要数据的不用口令。');
    }
    this.#dropExport();
    const now = this.#options.now();
    const id = `export-${randomUUID()}`;
    const directory = join(this.#root, EXPORTS_DIRECTORY, id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const job: ExportJob = {
      view: { id, mode, state: 'running', doneBytes: 0, totalBytes: 0, fileBytes: null, fileName: null,
        createdAt: now.toISOString(), expiresAt: null, error: null },
      path: null, abort: new AbortController(), requestId,
    };
    this.#export = job;
    const fileName = `plasticine-${stamp(now)}${mode === 'data' ? '-data' : ''}${MIGRATION_FILE_EXTENSION}`;
    void packState({
      stateDirectory: this.#options.stateDirectory, workDirectory: directory, fileName, mode, passphrase,
      snapshot: this.#options.snapshot, now: this.#options.now, signal: job.abort.signal,
      onProgress: (done, total) => {
        job.view.doneBytes = done;
        job.view.totalBytes = total;
      },
    }).then((packed) => {
      if (this.#export !== job) {
        rmSync(directory, { recursive: true, force: true });
        return;
      }
      const named = `plasticine-${safeName(packed.summary.handle ?? '')}-${stamp(now)}`
        + `${mode === 'data' ? '-data' : ''}${MIGRATION_FILE_EXTENSION}`;
      return rename(packed.path, join(directory, named)).then(() => {
        job.path = join(directory, named);
        job.view = { ...job.view, state: 'ready', fileBytes: packed.bytes, fileName: named,
          doneBytes: job.view.totalBytes, expiresAt: new Date(this.#options.now().getTime()
            + MIGRATION_EXPORT_KEEP_MS).toISOString() };
        writeFileSync(join(directory, 'export.json'), JSON.stringify(job.view), { mode: 0o600 });
      });
    }).catch((error: unknown) => {
      rmSync(directory, { recursive: true, force: true });
      if (this.#export !== job) {
        return;
      }
      safeLog('warn', 'migration_export_failed', { category: errorCategory(error) });
      job.view = { ...job.view, state: 'failed', error: job.abort.signal.aborted ? '取消了。' : '打包没做成，再试一次。' };
    });
    return this.status();
  }

  #dropExport(): void {
    if (this.#export === null) {
      return;
    }
    this.#export.abort.abort();
    rmSync(join(this.#root, EXPORTS_DIRECTORY, this.#export.view.id), { recursive: true, force: true });
    this.#export = null;
  }

  cancelExport(): MigrationStatus {
    this.#dropExport();
    return this.status();
  }

  /** 好了的那份文件（过期就没了）。 */
  exportFile(): { path: string; name: string; bytes: number } | null {
    const job = this.#export;
    if (job?.view.state !== 'ready' || job.path === null || job.view.fileName === null) {
      return null;
    }
    if (job.view.expiresAt !== null && Date.parse(job.view.expiresAt) <= this.#options.now().getTime()) {
      this.#dropExport();
      return null;
    }
    return { path: job.path, name: job.view.fileName, bytes: statSync(job.path).size };
  }

  // ---- 导入 ----

  #importDirectory(id: string): string {
    return join(this.#root, IMPORTS_DIRECTORY, id);
  }

  #saveImport(job: ImportJob): void {
    const meta = { view: job.view, requestId: job.requestId, createdAt: job.createdAt };
    writeFileSync(join(this.#importDirectory(job.view.id), IMPORT_META_FILE), JSON.stringify(meta), { mode: 0o600 });
  }

  #loadImport(): ImportJob | null {
    const root = join(this.#root, IMPORTS_DIRECTORY);
    const pending = readPending(this.#options.stateDirectory);
    if (!existsSync(root)) {
      return null;
    }
    for (const id of readdirSync(root)) {
      if (pending?.id === id) {
        continue;
      }
      try {
        const meta = JSON.parse(readFileSync(join(root, id, IMPORT_META_FILE), 'utf8')) as {
          view: MigrationImportView; requestId: string; createdAt: string };
        const job: ImportJob = { view: meta.view, requestId: meta.requestId, key: null, abort: null,
          createdAt: meta.createdAt };
        // 重启前在解的：解了一半的暂存不要了；加了密的回到等口令，没加密的重新解。
        if (job.view.state === 'staging' || job.view.state === 'applying' || job.view.state === 'staged') {
          rmSync(join(root, id, STAGED_DIRECTORY), { recursive: true, force: true });
          job.view = { ...job.view, state: job.view.encrypted === true ? 'locked' : 'staging', stagedBytes: 0,
            how: null };
          if (job.view.state === 'staging') {
            queueMicrotask(() => this.#stage(job));
          }
        }
        return job;
      } catch {
        rmSync(join(root, id), { recursive: true, force: true });
      }
    }
    return null;
  }

  #dropImport(): void {
    const job = this.#import;
    if (job === null) {
      return;
    }
    job.abort?.abort();
    rmSync(this.#importDirectory(job.view.id), { recursive: true, force: true });
    this.#import = null;
  }

  startImport(requestId: string, name: string, bytes: number): { import: MigrationImportView; received: number } {
    const existing = this.#import;
    if (existing !== null && existing.requestId === requestId) {
      return { import: { ...existing.view }, received: existing.view.received };
    }
    if (bytes * 2 + DISK_SPARE > this.#diskFree()) {
      throw new MigrationProblem('no_space', '这台磁盘不够放这一份（要两倍大小的空间：传上来一份、解开一份）。');
    }
    this.#dropImport();
    const id = `import-${randomUUID()}`;
    mkdirSync(this.#importDirectory(id), { recursive: true, mode: 0o700 });
    const job: ImportJob = {
      view: { id, name, state: 'uploading', bytes, received: 0, mode: null, encrypted: null, summary: null,
        stagedBytes: 0, how: null, error: null, errorCode: null },
      requestId, key: null, abort: null, createdAt: this.#options.now().toISOString(),
    };
    writeFileSync(join(this.#importDirectory(id), UPLOAD_FILE), Buffer.alloc(0), { mode: 0o600 });
    this.#import = job;
    this.#saveImport(job);
    return { import: { ...job.view }, received: 0 };
  }

  #requireImport(states: ReadonlyArray<MigrationImportView['state']>): ImportJob {
    const job = this.#import;
    if (job === null || !states.includes(job.view.state)) {
      throw new MigrationProblem('not_ready', '没有在导入的文件，或者这一步已经过了。');
    }
    return job;
  }

  /** 按顺序收一块；重发已经收过的那块照样回现在收到多少。 */
  async appendChunk(offset: number, data: Buffer): Promise<number> {
    const job = this.#requireImport(['uploading']);
    if (offset < job.view.received && offset + data.length <= job.view.received) {
      return job.view.received;
    }
    if (offset !== job.view.received || offset + data.length > job.view.bytes) {
      throw new MigrationProblem('bad_request', `分块的位置不对：已经收到 ${job.view.received} 字节。`);
    }
    const file = await open(join(this.#importDirectory(job.view.id), UPLOAD_FILE), 'r+');
    try {
      await file.write(data, 0, data.length, offset);
    } finally {
      await file.close();
    }
    job.view.received += data.length;
    this.#saveImport(job);
    return job.view.received;
  }

  #fail(job: ImportJob, error: unknown): void {
    if (this.#import !== job) {
      return;
    }
    let code: NonNullable<MigrationImportView['errorCode']> = 'failed';
    let text = '导入没做成，再试一次。';
    if (error instanceof TooNewError) {
      code = 'too_new';
      text = error.message;
    } else if (error instanceof MigrationFileError) {
      code = error.code;
      text = error.message;
    } else {
      safeLog('warn', 'migration_import_failed', { category: errorCategory(error) });
    }
    job.view = { ...job.view, state: 'failed', error: text, errorCode: code, how: null };
    this.#saveImport(job);
  }

  /** 传完了：读文件头；没加密的接着读摘要、在后台解开，加了密的等口令。 */
  async completeImport(): Promise<MigrationStatus> {
    const job = this.#requireImport(['uploading']);
    if (job.view.received !== job.view.bytes) {
      throw new MigrationProblem('bad_request', `还没传完：收到 ${job.view.received} / ${job.view.bytes} 字节。`);
    }
    const file = join(this.#importDirectory(job.view.id), UPLOAD_FILE);
    try {
      const { header } = await readHeader(file);
      job.view = { ...job.view, mode: header.mode, encrypted: header.encrypted };
      if (header.encrypted) {
        job.view.state = 'locked';
      } else {
        job.view = { ...job.view, state: 'staging', summary: await readSummary(file, null) };
        this.#stage(job);
      }
      this.#saveImport(job);
    } catch (error) {
      this.#fail(job, error);
    }
    return this.status();
  }

  /** 加了密的：口令对了就读摘要、在后台解开；不对报错，照样等口令。 */
  async unlock(passphrase: string): Promise<MigrationStatus> {
    const job = this.#requireImport(['locked']);
    const file = join(this.#importDirectory(job.view.id), UPLOAD_FILE);
    const { header } = await readHeader(file);
    if (header.kdf === undefined) {
      throw new MigrationProblem('bad_request', '这一份没有加密。');
    }
    const key = await deriveKey(passphrase, header.kdf);
    try {
      const summary = await readSummary(file, key);
      job.key = key;
      job.view = { ...job.view, state: 'staging', summary };
      this.#saveImport(job);
      this.#stage(job);
    } catch (error) {
      if (error instanceof MigrationFileError && error.code === 'wrong_passphrase') {
        throw new MigrationProblem('wrong_passphrase', error.message);
      }
      this.#fail(job, error);
    }
    return this.status();
  }

  #stage(job: ImportJob): void {
    const directory = this.#importDirectory(job.view.id);
    const abort = new AbortController();
    job.abort = abort;
    void stageArchive({
      file: join(directory, UPLOAD_FILE), key: job.key, directory: join(directory, STAGED_DIRECTORY),
      signal: abort.signal,
      onProgress: (offset) => {
        job.view.stagedBytes = offset;
      },
    }).then((summary: MigrationSummary) => {
      job.key = null;
      if (this.#import !== job) {
        return;
      }
      rmSync(join(directory, UPLOAD_FILE), { force: true });
      const how = job.view.how;
      job.view = { ...job.view, summary, stagedBytes: job.view.bytes, state: how === null ? 'staged' : 'applying' };
      this.#saveImport(job);
      if (how !== null) {
        this.#commit(job, how);
      }
    }, (error: unknown) => {
      job.key = null;
      this.#fail(job, error);
    });
  }

  #commit(job: ImportJob, how: MigrationHow): void {
    const summary = job.view.summary;
    writePending(this.#options.stateDirectory, { kind: how, id: job.view.id, mode: job.view.mode ?? 'data',
      handle: summary?.handle ?? null, exportedAt: summary?.exportedAt ?? null });
    this.#import = null;
    this.#options.restart();
  }

  /** 选好合并还是替换：解好了马上重启，还在解就等解完。 */
  apply(how: MigrationHow): { restarting: boolean; status: MigrationStatus } {
    const job = this.#requireImport(['staging', 'staged', 'applying']);
    if (job.view.state === 'staged') {
      job.view = { ...job.view, state: 'applying', how };
      this.#saveImport(job);
      const status = this.status();
      this.#commit(job, how);
      return { restarting: true, status };
    }
    job.view = { ...job.view, state: 'applying', how };
    this.#saveImport(job);
    return { restarting: false, status: this.status() };
  }

  cancelImport(): MigrationStatus {
    this.#dropImport();
    return this.status();
  }

  /** 退回到导入前（7 天内）：写好要做的事，重启。 */
  undo(): { restarting: boolean; status: MigrationStatus } {
    const before = readBefore(this.#options.stateDirectory);
    if (before === null) {
      throw new MigrationProblem('not_ready', '没有导入前留的那一份了（过了 7 天会删掉）。');
    }
    writePending(this.#options.stateDirectory, { kind: 'undo', id: before.id, mode: before.meta.mode, handle: null,
      exportedAt: null });
    const status = this.status();
    this.#options.restart();
    return { restarting: true, status };
  }

  /** 定时清理（过期的导出、导入前的那一份、没传完的上传）。 */
  sweep(): void {
    cleanupMigration(this.#options.stateDirectory, this.#options.now(),
      [this.#export?.view.id, this.#import?.view.id].filter((id): id is string => id !== undefined));
    if (this.#export !== null && !existsSync(join(this.#root, EXPORTS_DIRECTORY, this.#export.view.id))) {
      this.#export = null;
    }
  }
}
