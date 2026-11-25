import { ApiError } from '../errors.ts';
import type { MigrationApi } from '../migration-client.ts';
import type {
  MigrationApplyResponse, MigrationHow, MigrationImportView, MigrationMode, MigrationStatus, MigrationSummary,
} from '../shared.ts';
import type { FakeSession } from './fake-session.ts';

const GB = 1024 ** 3;
const DAY_MS = 86_400_000;
const RESULT_DELAY_MS = 6_000;
const STEP_MS = 150;

function summary(mode: MigrationMode, now: Date): MigrationSummary {
  return { format: 'plasticine-migration-v1', mode, exportedAt: new Date(now.getTime() - 40 * 60_000).toISOString(),
    handle: 'linyu', schema: [], bytes: Math.round(1.9 * GB),
    counts: { lines: 312, memory: 1204, notes: 86, files: 2031, books: 7, spaces: 12, skills: 14 } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FakeMigration implements MigrationApi {
  private readonly session: FakeSession;
  private readonly now: () => Date;
  private current: MigrationStatus;

  constructor(session: FakeSession, now: () => Date, scene: string | null) {
    this.session = session;
    this.now = now;
    this.current = { export: null, import: null, before: null, result: null, diskFreeBytes: Math.round(48 * GB) };
    if (scene === 'migration') {
      const at = now();
      this.current.export = { id: 'export-1', mode: 'full', state: 'ready', doneBytes: 0, totalBytes: 0,
        fileBytes: Math.round(1.9 * GB), fileName: 'plasticine-linyu-1116-2240.plasticine',
        createdAt: new Date(at.getTime() - 12 * 60_000).toISOString(),
        expiresAt: new Date(at.getTime() + DAY_MS).toISOString(), error: null };
      this.current.before = { id: 'import-0', how: 'merge', at: new Date(at.getTime() - 3 * 60_000).toISOString(),
        expiresAt: new Date(at.getTime() + 7 * DAY_MS).toISOString() };
    }
  }

  private copy(): MigrationStatus {
    return structuredClone(this.current);
  }

  async status(): Promise<MigrationStatus> {
    this.session.requireUser();
    const job = this.current.export;
    if (job?.state === 'running') {
      job.doneBytes = Math.min(job.totalBytes, job.doneBytes + Math.round(0.3 * job.totalBytes));
      if (job.doneBytes >= job.totalBytes) {
        Object.assign(job, { state: 'ready', fileBytes: Math.round(job.totalBytes * 0.97),
          fileName: `plasticine-linyu-1116-2240${job.mode === 'data' ? '-data' : ''}.plasticine`,
          expiresAt: new Date(this.now().getTime() + DAY_MS).toISOString() });
      }
    }
    const view = this.current.import;
    if (view?.state === 'staging') {
      view.state = 'staged';
      view.stagedBytes = view.bytes;
    }
    return this.copy();
  }

  async startExport(mode: MigrationMode, passphrase: string | null): Promise<MigrationStatus> {
    this.session.requireUser();
    if ((mode === 'full') !== (passphrase !== null)) {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', message: '全部导出要设口令。', status: 400 });
    }
    this.current.export = { id: `export-${this.now().getTime()}`, mode, state: 'running', doneBytes: 0,
      totalBytes: Math.round(1.9 * GB), fileBytes: null, fileName: null, createdAt: this.now().toISOString(),
      expiresAt: null, error: null };
    return this.copy();
  }

  async cancelExport(): Promise<MigrationStatus> {
    this.current.export = null;
    return this.copy();
  }

  exportUrl(): string {
    return '#/settings/system';
  }

  async upload(file: Blob, name: string, onProgress?: (fraction: number) => void, signal?: AbortSignal):
    Promise<MigrationStatus> {
    this.session.requireUser();
    const bytes = Math.max(file.size, Math.round(1.9 * GB));
    for (const fraction of [0.1, 0.34, 0.62, 0.9, 1]) {
      await sleep(STEP_MS);
      if (signal?.aborted === true) throw new Error('取消了');
      onProgress?.(fraction);
    }
    const base: MigrationImportView = { id: 'import-1', name, state: 'locked', bytes, received: bytes, mode: 'full',
      encrypted: true, summary: null, stagedBytes: 0, how: null, error: null, errorCode: null };
    if (name.includes('new')) {
      this.current.import = { ...base, state: 'failed', errorCode: 'too_new',
        error: '这一份是新版导出的，这台还是旧版：先在设置 · 系统里更新这台，再导入。' };
    } else if (name.includes('data')) {
      this.current.import = { ...base, state: 'staging', mode: 'data', encrypted: false,
        summary: summary('data', this.now()) };
    } else {
      this.current.import = base;
    }
    return this.copy();
  }

  async unlock(passphrase: string): Promise<MigrationStatus> {
    await sleep(STEP_MS);
    if (passphrase.includes('wrong')) {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', message: '口令不对，再试一次。', status: 400 });
    }
    const view = this.current.import;
    if (view !== null) {
      Object.assign(view, { state: 'staging', summary: summary('full', this.now()) });
    }
    return this.copy();
  }

  async apply(how: MigrationHow): Promise<MigrationApplyResponse> {
    const status = this.copy();
    const handle = this.current.import?.summary?.handle ?? null;
    this.current.import = null;
    setTimeout(() => {
      const at = this.now().toISOString();
      this.current.result = { kind: how, at, handle, exportedAt: at, kept: how === 'merge' ? 9 : 0, error: null,
        added: how === 'merge' ? { lines: 140, memory: 380, notes: 86, files: 312, books: 0, spaces: 3, skills: 2 }
          : null };
      this.current.before = { id: 'import-1', how, at, expiresAt: new Date(Date.now() + 7 * DAY_MS).toISOString() };
    }, RESULT_DELAY_MS);
    return { restarting: true, status };
  }

  async cancelImport(): Promise<MigrationStatus> {
    this.current.import = null;
    return this.copy();
  }

  async undo(): Promise<MigrationApplyResponse> {
    const status = this.copy();
    setTimeout(() => {
      this.current.result = { kind: 'undo', at: this.now().toISOString(), handle: null, exportedAt: null, added: null,
        kept: 0, error: null };
      this.current.before = null;
    }, RESULT_DELAY_MS);
    return { restarting: true, status };
  }
}
