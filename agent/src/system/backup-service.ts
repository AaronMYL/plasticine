// 本机备份：每天一份数据库与笔记的一致快照（只留最新 2 份、每份 7 天，2026-11-13 定），手动也能做一份；按对象恢复要先预览、
// 在卡上核对确认。2026-11-05 Harness 重做：不再借任务系统记进度，自己一个定时器每小时看一眼今天的那份做了没有。

import type { Backup, BackupObjectKind, RestoreBackupRequest, RestorePreview } from '../../shared/api/index.ts';
import type { DeviceConfirmation } from '../../shared/state.ts';
import type { AfterCommit, AskDesk, AskResolver } from '../attention/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { StateError, type StateService } from '../state/index.ts';

// 每小时看一次今天的备份有没有：重启、睡眠错过了也只晚一小时。
export const BACKUP_CHECK_MS = 60 * 60 * 1000;
const BACKUP_TIME_ZONE = 'Asia/Shanghai';

export interface BackupServiceOptions {
  state: StateService;
  desk: AskDesk;
  now: () => Date;
  /** 自动每日备份（测试关掉）。 */
  automatic: boolean;
  changed: () => void;
  restored: (kind: BackupObjectKind, id: string) => void;
  /** 测试换成手拨的定时。 */
  every?: (ms: number, run: () => void) => () => void;
}

const realEvery = (ms: number, run: () => void): (() => void) => {
  const timer = setInterval(run, ms);
  timer.unref();
  return () => clearInterval(timer);
};

export class BackupService {
  readonly #options: BackupServiceOptions;
  #stopped = false;
  #cancel: (() => void) | null = null;

  constructor(options: BackupServiceOptions) {
    this.#options = options;
  }

  /** 自动每日备份开着没有。 */
  get automatic(): boolean {
    return this.#options.automatic;
  }

  readonly resolver: AskResolver = {
    resolve: (_changes, ask) => {
      const row = this.#options.state.backups.byAsk(ask.id);
      if (row?.status !== 'restored') {
        throw new StateError('invalid_input', '恢复需要核对指定预览，不能直接答卡。');
      }
    },
  };

  /** 启动：上次被重启打断的标成失败，然后马上看一次今天的，再每小时看一次。 */
  start(): void {
    const { state } = this.#options;
    for (const row of state.backups.list()) {
      if (row.status === 'running') {
        state.backups.update(row.id, { status: 'failed', error: '备份被重启中断，原目录保留待核对。' });
      } else if (row.status === 'queued') {
        this.#queue(row.id);
      }
    }
    this.scan();
    this.#cancel = (this.#options.every ?? realEvery)(BACKUP_CHECK_MS, () => this.scan());
  }

  create(requestId: string, reason: Backup['reason'], after: AfterCommit): Backup {
    const { state, desk, changed } = this.#options;
    return desk.commit((changes) => {
      const row = state.backups.begin(requestId, reason);
      changes.afterCommit(() => {
        changed();
        this.#queue(row.id);
      });
      return row;
    }, after);
  }

  #queue(id: string): void {
    queueMicrotask(() => {
      if (!this.#stopped) {
        this.#finish(id);
      }
    });
  }

  #finish(id: string): void {
    const { state, changed } = this.#options;
    const row = state.backups.require(id);
    if (row.status !== 'queued') {
      return;
    }
    try {
      state.backups.complete(id);
    } catch (error) {
      safeLog('error', 'backup_failed', { objectId: id, category: errorCategory(error) });
      state.backups.update(id, { status: 'failed', error: '快照没有写成，原目录保留待核对。' });
    }
    changed();
  }

  /** 今天的那份没做就做一份，顺手按保留规则清旧的。 */
  scan(): void {
    if (this.#stopped || !this.#options.automatic) {
      return;
    }
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: BACKUP_TIME_ZONE }).format(this.#options.now());
    this.create(`backup-daily-${day}`, 'daily', (action) => action());
    try {
      this.#options.state.backups.prune();
    } catch (error) {
      safeLog('warn', 'backup_prune_failed', { category: errorCategory(error) });
    }
  }

  preview(backupId: string, requestId: string, kind: BackupObjectKind, objectId: string, after: AfterCommit)
    : RestorePreview {
    const { state, desk, changed } = this.#options;
    return desk.commit((changes) => {
      const row = state.backups.preview(backupId, requestId, kind, objectId);
      if (row.askId !== null || row.blocked.length > 0) {
        return this.view(row.id);
      }
      const ask = desk.raise(changes, {
        kind: 'confirm',
        purpose: 'backup_restore',
        question: `恢复《${row.objectLabel ?? '这项内容'}》？`,
        detail: '按预览恢复，会先保存现在的版本。',
        context: { restorePreviewId: row.id },
        actionId: `backup-restore:${row.id}`,
        options: [{ id: 'restore', label: '核对后恢复' }],
      });
      state.backups.updatePreview(row.id, { askId: ask.id, askVersion: ask.version });
      changes.afterCommit(changed);
      return this.view(row.id);
    }, after);
  }

  view(id: string): RestorePreview {
    const row = this.#options.state.backups.getPreview(id);
    return { ...row, askVersion: row.askId === null ? 0 : this.#options.state.asks.require(row.askId).version };
  }

  safetyCopy(previewId: string): void {
    const { state } = this.#options;
    const row = state.backups.getPreview(previewId);
    if (row.status === 'restored') {
      return;
    }
    const safety = state.backups.begin(`backup-safety-${previewId}`, 'before_restore');
    const completed = state.backups.complete(safety.id);
    if (completed.status !== 'ready' && completed.status !== 'partial') {
      throw new StateError('invalid_input', '当前状态快照没有存好，尚未恢复。');
    }
    state.backups.updatePreview(row.id, { safetyBackupId: safety.id });
  }

  restore(backupId: string, body: RestoreBackupRequest, proof: DeviceConfirmation, after: AfterCommit)
    : RestorePreview {
    const { state, desk, changed } = this.#options;
    return desk.commit((changes) => {
      const row = this.view(body.previewId);
      if (row.backupId !== backupId || row.backupName !== body.backupName || row.digest !== body.digest) {
        throw new StateError('invalid_input', '确认内容与这份备份和预览不一致。');
      }
      if (row.status === 'restored') {
        return row;
      }
      if (row.askVersion !== body.askVersion || row.askId === null
        || state.asks.require(row.askId).status !== 'open' || row.safetyBackupId === null) {
        throw new StateError('version_conflict', '恢复卡已变化，或当前状态未备份，请重新核对。');
      }
      state.backups.restore(row.id, row.digest, proof);
      changes.afterCommit(() => this.#options.restored(row.kind, row.objectId));
      desk.answerWithin(changes, { askId: row.askId, optionId: 'restore', answerer: { deviceId: proof.deviceId } });
      changes.afterCommit(changed);
      return this.view(row.id);
    }, after);
  }

  stop(): void {
    this.#stopped = true;
    this.#cancel?.();
    this.#cancel = null;
  }
}
