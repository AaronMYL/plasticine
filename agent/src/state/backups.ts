import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Type } from 'typebox';
import {
  BackupSchema,
  RestorePreviewSchema,
  type Backup,
  type BackupDetail,
  type BackupObjectKind,
  type RestorePreview,
} from '../../shared/api/backups.ts';
import type { DeviceConfirmation } from '../../shared/state.ts';
import type { StoreContext } from './object-store.ts';
import { checked, readRow } from './codec.ts';
import { requireConfirmation } from './confirmed-fields.ts';
import { Database } from './db.ts';
import { StateError } from './errors.ts';
import { backupObjectAccess, backupObjectLabel, RESTORE_EXCLUDED } from './backup-objects.ts';
import {
  privateDirectory,
  safeBackupPath,
  sha256,
  snapshotFiles,
  verifyBackupFiles,
  writePrivate,
  type BackupManifest,
} from './backup-files.ts';
import { expiredBackups } from './backup-retention.ts';
const BackupRow = Type.Object({ metadata: BackupSchema });
const PreviewRow = Type.Object({ metadata: RestorePreviewSchema });
const PREVIEW_CHARS = 12_000;
export interface BackupStoreOptions {
  directory?: string;
  notesDirectory?: string;
  enforceOwner?: boolean;
}
export function createBackupStore(context: StoreContext, options: BackupStoreOptions) {
  const { db, now, newId } = context;
  const root = (): string => {
    if (options.directory === undefined) {
      throw new StateError('invalid_input', '未配置本机备份目录。');
    }
    privateDirectory(options.directory, options.enforceOwner ?? false);
    return options.directory;
  };
  const location = (id: string): string => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
      throw new StateError('invalid_input', '备份标识无效。');
    }
    return safeBackupPath(root(), id);
  };
  const require = (id: string): Backup => {
    const row = db.get('SELECT metadata FROM backups WHERE id = $id', { id });
    if (row === undefined) {
      throw new StateError('not_found', '没有这份备份。');
    }
    return readRow(BackupRow, { metadata: 'json' }, row, '本机备份').metadata;
  };
  const update = (id: string, patch: Partial<Backup>): Backup => {
    const value = checked(BackupSchema, { ...require(id), ...patch }, 'invalid_input', '备份状态');
    db.run('UPDATE backups SET metadata = $metadata WHERE id = $id', { id, metadata: JSON.stringify(value) });
    return value;
  };
  const list = (): Backup[] =>
    db
      .all('SELECT metadata FROM backups ORDER BY rowid DESC')
      .map((row) => readRow(BackupRow, { metadata: 'json' }, row, '本机备份').metadata);
  const verified = (id: string): BackupManifest => {
    const row = require(id);
    if (row.status !== 'ready' || row.manifestDigest === null) {
      throw new Error('备份尚未通过校验。');
    }
    const manifest = verifyBackupFiles(location(id), row.manifestDigest);
    if (manifest.id !== id) {
      throw new Error('备份标识不匹配。');
    }
    return manifest;
  };
  const snapshot = <T,>(id: string, work: (access: ReturnType<typeof backupObjectAccess>) => T): T => {
    verified(id);
    const directory = location(id);
    const reader = new Database(new DatabaseSync(join(directory, 'plasticine.sqlite'), { readOnly: true }), undefined);
    try {
      return work(backupObjectAccess({ ...context, db: reader }, join(directory, 'notes')));
    } finally {
      reader.close();
    }
  };
  const access = () => {
    if (options.notesDirectory === undefined) {
      throw new StateError('invalid_input', '未配置笔记目录。');
    }
    return backupObjectAccess(context, options.notesDirectory);
  };
  const getPreview = (id: string): RestorePreview => {
    const row = db.get('SELECT metadata FROM restore_previews WHERE id = $id', { id });
    if (row === undefined) {
      throw new StateError('not_found', '没有这份恢复预览。');
    }
    return readRow(PreviewRow, { metadata: 'json' }, row, '恢复预览').metadata;
  };
  const updatePreview = (id: string, patch: Partial<RestorePreview>): RestorePreview => {
    const value = checked(RestorePreviewSchema, { ...getPreview(id), ...patch }, 'invalid_input', '恢复预览');
    db.run('UPDATE restore_previews SET metadata = $metadata WHERE id = $id', { id, metadata: JSON.stringify(value) });
    return value;
  };
  return {
    require,
    update,
    list,
    getPreview,
    updatePreview,
    byAsk(id: string): RestorePreview | undefined {
      const row = db.get("SELECT metadata FROM restore_previews WHERE json_extract(metadata, '$.askId') = $id", { id });
      return row === undefined ? undefined : readRow(PreviewRow, { metadata: 'json' }, row, '恢复预览').metadata;
    },
    begin(requestId: string, reason: Backup['reason']): Backup {
      const old = db.get('SELECT metadata FROM backups WHERE request_id = $requestId', { requestId });
      if (old !== undefined) {
        return readRow(BackupRow, { metadata: 'json' }, old, '本机备份').metadata;
      }
      const id = newId();
      const at = now();
      const value = checked(
        BackupSchema,
        {
          id,
          requestId,
          reason,
          name: `${at.slice(0, 10)}-${id.slice(0, 8)}`,
          status: 'queued',
          createdAt: at,
          completedAt: null,
          bytes: 0,
          manifestDigest: null,
          taskId: null,
          error: null,
          privatePermissions: process.platform === 'linux' && options.enforceOwner === true,
        },
        'invalid_input',
        '新建备份',
      );
      db.run('INSERT INTO backups (id, request_id, metadata) VALUES ($id, $requestId, $metadata)', {
        id,
        requestId,
        metadata: JSON.stringify(value),
      });
      return value;
    },
    complete(id: string): Backup {
      const row = require(id);
      if (row.status !== 'queued') {
        return row;
      }
      update(id, { status: 'running' });
      try {
        const directory = location(id);
        mkdirSync(directory, { mode: 0o700 });
        writePrivate(join(directory, 'owner.json'), JSON.stringify({ id, format: 'plasticine-local-backup-v1' }));
        if (options.notesDirectory === undefined) {
          throw new Error('未配置笔记文件。');
        }
        const result = snapshotFiles(
          db,
          options.notesDirectory,
          directory,
          id,
          row.createdAt,
          row.reason === 'before_restore',
        );
        verifyBackupFiles(directory, result.digest);
        const incomplete = result.manifest.missing.length > 0;
        return update(id, {
          status: incomplete ? 'partial' : 'ready',
          completedAt: now(),
          bytes: result.bytes,
          objectCount: Object.values(result.manifest.counts).reduce((sum, count) => sum + count, 0),
          manifestDigest: result.digest,
          error: incomplete ? '当前状态有缺失或改变的原件，快照只供离线核对。' : null,
        });
      } catch {
        return update(id, { status: 'failed', error: '备份未完成：请核对目录权限、空间或缺失文件。' });
      }
    },
    verify(id: string): { valid: boolean; error: string | null } {
      try {
        verified(id);
        return { valid: true, error: null };
      } catch {
        return { valid: false, error: '备份未通过完整性校验，不能恢复。' };
      }
    },
    detail(id: string): BackupDetail {
      try {
        const manifest = verified(id);
        return {
          backup: require(id),
          objects: snapshot(id, (reader) => reader.list()),
          valid: true,
          scope: '本机数据库一致快照与笔记全部已登记版本、引用图片；没有外传或下载。',
          excluded: ['库外凭据和配置', '成果原件和对话附件原件（不属于库与笔记范围）'],
          schema: manifest.schema,
          counts: manifest.counts,
        };
      } catch {
        return {
          backup: require(id),
          objects: [],
          valid: false,
          schema: [],
          counts: {},
          scope: '备份未通过校验，不能恢复。',
          excluded: [],
        };
      }
    },
    preview(backupId: string, requestId: string, kind: BackupObjectKind, objectId: string): RestorePreview {
      const old = db.get('SELECT id FROM restore_previews WHERE request_id = $requestId', { requestId });
      if (old !== undefined) {
        const previous = getPreview(String(old['id']));
        if (previous.backupId !== backupId || previous.kind !== kind || previous.objectId !== objectId) {
          throw new StateError('invalid_input', '恢复请求标识已用于别的对象。');
        }
        return previous;
      }
      const source = snapshot(backupId, (reader) => reader.read(kind, objectId));
      if (source === null) {
        throw new StateError('not_found', '备份中没有这个对象。');
      }
      const current = access().read(kind, objectId);
      const plan = access().plan(kind, source, current);
      const id = newId();
      const baseVersion = Number(current?.['version'] ?? 0);
      const digest = sha256(
        JSON.stringify({
          backup: require(backupId).manifestDigest,
          kind,
          objectId,
          baseVersion,
          patch: plan.patch,
          excluded: RESTORE_EXCLUDED,
        }),
      );
      const display = (value: unknown) => {
        let remaining = PREVIEW_CHARS;
        const clip = (text: string) => {
          const visible = text.slice(0, remaining);
          remaining -= visible.length;
          return visible.length === text.length ? text : `${visible}\n（内容较长，预览已截断）`;
        };
        // 只截断字段值，保留结构完整，客户端才能把字段和枚举译成可读的对照。
        return typeof value === 'string'
          ? clip(value)
          : JSON.stringify(
              value,
              (_key: string, field: unknown) => typeof field === 'string' ? clip(field) : field,
              2,
            );
      };
      const value = checked(
        RestorePreviewSchema,
        {
          id,
          backupId,
          backupName: require(backupId).name,
          backupCreatedAt: require(backupId).createdAt,
          objectLabel: backupObjectLabel(source),
          kind,
          objectId,
          baseVersion,
          sourceVersion: Number(source['version']),
          digest,
          fields: plan.fields,
          private: source['private'] === true || current?.['private'] === true,
          before: display(kind === 'note' ? plan.before['markdown'] : plan.before),
          after: display(kind === 'note' ? plan.patch['markdown'] : plan.patch),
          excluded: RESTORE_EXCLUDED,
          blocked: plan.blocked,
          status: 'pending',
          askId: null,
          askVersion: 0,
          safetyBackupId: null,
          resultVersion: null,
        },
        'invalid_input',
        '恢复预览',
      );
      db.run(
        'INSERT INTO restore_previews (id, request_id, backup_id, metadata, patch) ' +
          'VALUES ($id, $requestId, $backupId, $metadata, $patch)',
        { id, requestId, backupId, metadata: JSON.stringify(value), patch: JSON.stringify(plan.patch) },
      );
      return value;
    },
    restore(id: string, digest: string, proof: DeviceConfirmation): RestorePreview {
      requireConfirmation(proof);
      return db.transaction(() => {
        const preview = getPreview(id);
        if (preview.digest !== digest) {
          throw new StateError('invalid_input', '恢复摘要不匹配。');
        }
        if (preview.status === 'restored') {
          return preview;
        }
        if (preview.status !== 'pending' || preview.blocked.length > 0) {
          throw new StateError('invalid_input', '这个对象不能按这份预览恢复。');
        }
        verified(preview.backupId);
        const current = access().read(preview.kind, preview.objectId);
        if (current?.['version'] !== preview.baseVersion) {
          throw new StateError('version_conflict', '对象版本已变化，请重新预览。');
        }
        const raw = db.get('SELECT patch FROM restore_previews WHERE id = $id', { id });
        const patch = JSON.parse(String(raw?.['patch'])) as Record<string, unknown>;
        if (preview.kind === 'note') {
          access().restoreAssets(location(preview.backupId), String(patch['markdown']));
        }
        const resultVersion = access().apply(preview.kind, preview.objectId, preview.baseVersion, patch, proof);
        db.run('UPDATE restore_previews SET confirmation = $proof WHERE id = $id', {
          id,
          proof: JSON.stringify(proof),
        });
        return updatePreview(id, { status: 'restored', resultVersion });
      });
    },
    /** 只留最新 2 份、每份满 7 天就清（2026-11-13 定，backup-retention.ts）。 */
    prune(): void {
      const expired = new Set(expiredBackups(list(), now()));
      for (const row of list()) {
        if (!expired.has(row.id)) {
          continue;
        }
        const directory = location(row.id);
        if (existsSync(directory)) {
          const owner: Record<string, unknown> = JSON.parse(
            readFileSync(safeBackupPath(directory, 'owner.json'), 'utf8'),
          );
          if (owner['id'] !== row.id || owner['format'] !== 'plasticine-local-backup-v1') {
            throw new Error('备份保留期清理遇到未登记目录，已停止。');
          }
          rmSync(directory, { recursive: true });
        }
        update(row.id, { status: 'expired' });
      }
    },
  };
}
