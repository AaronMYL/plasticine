import type { BackupsApi } from '../client.ts';
import type {
  Backup,
  BackupDetail,
  BackupList,
  CreateBackupRequest,
  RestorePreviewRequest,
  RestorePreview,
  RestoreBackupRequest,
  NoteView,
} from '../shared.ts';
import { ApiError } from '../errors.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeNotes } from './fake-notes.ts';
import type { FakeAsks } from './fake-asks.ts';
import type { FakeReceipts } from './receipts.ts';
interface Options {
  session: FakeSession;
  bus: FakeEventBus;
  notes: FakeNotes;
  asks: FakeAsks;
  receipts: FakeReceipts;
  now: () => Date;
}
const conflict = () =>
  new ApiError({
    kind: 'conflict',
    code: 'version_conflict',
    status: 409,
    message: '恢复对象或预览已变化，请重新预览。',
  });
export class FakeBackups implements BackupsApi {
  private readonly options: Options;
  private readonly rows = new Map<string, Backup>();
  private readonly snapshots = new Map<string, NoteView[]>();
  private readonly previews = new Map<string, RestorePreview>();
  constructor(options: Options) {
    this.options = options;
  }
  async list(): Promise<BackupList> {
    this.options.session.require();
    return { backups: [...this.rows.values()].reverse(), retentionDays: 30, schedule: '本机每天一份，留 30 天。' };
  }
  async get(id: string): Promise<BackupDetail> {
    this.options.session.require();
    const backup = this.rows.get(id);
    if (backup === undefined) {
      throw conflict();
    }
    const notes = this.snapshots.get(id) ?? [];
    return {
      backup,
      valid: true,
      scope: '本机数据库与笔记文件；没有外传或下载。',
      schema: ['0021-backups'],
      counts: { notes: notes.length },
      excluded: ['库外凭据和配置', '成果原件和对话附件原件'],
      objects: notes.map((note) => ({
        kind: 'note',
        id: note.id,
        version: note.version,
        label: note.title,
        private: note.private,
      })),
    };
  }
  async create(body: CreateBackupRequest): Promise<Backup> {
    this.options.session.require();
    return this.options.receipts.run('backup', body.requestId, `create:${JSON.stringify(body)}`, () => {
      const id = `backup-${body.requestId}`;
      const at = this.options.now().toISOString();
      const row: Backup = {
        id,
        requestId: body.requestId,
        name: `${at.slice(0, 10)}-${this.rows.size + 1}`,
        reason: 'manual',
        status: 'ready',
        createdAt: at,
        completedAt: at,
        bytes: 4096,
        objectCount: this.options.notes.backupSnapshots().length,
        manifestDigest: 'a'.repeat(64),
        taskId: null,
        error: null,
        privatePermissions: false,
      };
      this.rows.set(id, row);
      this.snapshots.set(id, this.options.notes.backupSnapshots());
      this.options.bus.emit({ type: 'backups.changed' });
      return row;
    });
  }
  async preview(id: string, body: RestorePreviewRequest): Promise<RestorePreview> {
    this.options.session.require();
    const current = await this.options.notes.get(body.objectId);
    return this.options.receipts.run('backup', body.requestId, `preview:${id}:${JSON.stringify(body)}`, () => {
      const note = this.snapshots.get(id)?.find((row) => row.id === body.objectId);
      const backup = this.rows.get(id);
      if (note === undefined || backup === undefined || body.kind !== 'note') {
        throw conflict();
      }
      const previewId = `preview-${body.requestId}`;
      const askId = `ask-${previewId}`;
      const row: RestorePreview = {
        id: previewId,
        backupId: id,
        backupName: backup.name,
        backupCreatedAt: backup.createdAt,
        objectLabel: note.title,
        kind: 'note',
        objectId: note.id,
        baseVersion: current.version,
        sourceVersion: note.version,
        digest: 'b'.repeat(64),
        private: note.private || current.private,
        before: current.markdown,
        after: note.markdown,
        fields: ['markdown'],
        excluded: ['确认字段和删除状态'],
        blocked: current.deletedAt === null ? [] : ['对象已删除，不能从旧快照复活'],
        status: 'pending',
        askId,
        askVersion: 1,
        safetyBackupId: null,
        resultVersion: null,
      };
      this.previews.set(row.id, row);
      this.options.asks.raise({
        id: askId,
        kind: 'confirm',
        question: '恢复这一个对象？',
        restorePreviewId: row.id,
        options: [{ id: 'restore', label: '核对后确认恢复', recommended: false, description: null }],
      });
      return row;
    });
  }
  async getPreview(id: string): Promise<RestorePreview> {
    this.options.session.require();
    const row = this.previews.get(id);
    if (row === undefined) {
      throw conflict();
    }
    await this.options.notes.get(row.objectId);
    return { ...row, askVersion: row.askId === null ? 0 : (await this.options.asks.get(row.askId)).version };
  }
  async restore(backupId: string, body: RestoreBackupRequest): Promise<RestorePreview> {
    const row = await this.getPreview(body.previewId);
    if (row.backupId !== backupId || row.backupName !== body.backupName || row.digest !== body.digest) {
      throw conflict();
    }
    if (row.status === 'restored') {
      return row;
    }
    if (row.blocked.length > 0 || row.askVersion !== body.askVersion) {
      throw conflict();
    }
    const safety = await this.create({ requestId: `safety-${row.id}` });
    const saved = await this.options.notes.save(row.objectId, {
      requestId: `restore-${row.id}`,
      version: row.baseVersion,
      markdown: row.after,
    });
    this.options.asks.answerElsewhere(row.askId ?? '', 'restore');
    const restored: RestorePreview = {
      ...row,
      status: 'restored',
      resultVersion: saved.version,
      safetyBackupId: safety.id,
    };
    this.previews.set(row.id, restored);
    this.options.bus.emit({ type: 'backups.changed' });
    return restored;
  }
}
