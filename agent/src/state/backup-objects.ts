import { readFileSync } from 'node:fs';
import type { BackupObject, BackupObjectKind } from '../../shared/api/backups.ts';
import { AgreementPatchSchema, MemoryEntryPatchSchema, type DeviceConfirmation } from '../../shared/state.ts';
import { createAgreementStore } from './agreements.ts';
import { createMemoryStore } from './memory.ts';
import { createNoteStore } from './notes.ts';
import { NoteBodies } from './note-bodies.ts';
import type { StoreContext } from './object-store.ts';
import { checked } from './codec.ts';
import { StateError } from './errors.ts';
import { BACKUP_TABLES, safeBackupPath, writePrivate } from './backup-files.ts';
type Values = Record<string, unknown>;
export function backupObjectLabel(value: Values): string {
  const label = value['title'] ?? value['statement'] ?? value['label'] ?? value['text'] ?? value['content'];
  return typeof label === 'string' && label.trim() !== '' ? label.slice(0, 80) : '未命名内容';
}
const FIELDS = {
  note: ['markdown'],
  agreement: ['proposedDiff'],
  memory_entry: ['text', 'applicability', 'provenance'],
} as const;
export const RESTORE_EXCLUDED = [
  '删除、撤销、失效及生命周期状态',
  '已确认的 p、现实结果、有效约定及设备权限',
  '登录、配对、执行节点身份、推送及外部凭据',
  '任务执行、外部动作和发布队列',
];
export function backupObjectAccess(context: StoreContext, notesDirectory: string) {
  const notes = createNoteStore(context, new NoteBodies(notesDirectory));
  const stores = {
    agreement: createAgreementStore(context),
    memory_entry: createMemoryStore(context),
  };
  const read = (kind: BackupObjectKind, id: string): Values | null => {
    if (kind === 'note') {
      const row = notes.get(id);
      return row === undefined
        ? null
        : { ...row, markdown: notes.inspectBody(row) === undefined ? '（当前正文文件缺失）' : notes.readBody(row) };
    }
    const row = stores[kind].get(id);
    return row === undefined ? null : { ...row };
  };
  return {
    read,
    list(): BackupObject[] {
      const result: BackupObject[] = [];
      for (const [kind, table] of Object.entries(BACKUP_TABLES)) {
        for (const row of context.db.all(`SELECT id, version FROM ${table} ORDER BY id`)) {
          const id = String(row['id']);
          const note = kind === 'note' ? notes.require(id) : null;
          result.push({
            kind: kind as BackupObjectKind,
            id,
            version: Number(row['version']),
            private: note?.private ?? false,
            label: backupObjectLabel(read(kind as BackupObjectKind, id) ?? {}),
          });
        }
      }
      return result;
    },
    plan(kind: BackupObjectKind, source: Values, current: Values | null) {
      const blocked: string[] = [];
      if (current === null) {
        blocked.push('当前对象已不存在，不能从旧快照复活。');
      }
      if (
        current?.['deletedAt'] ||
        current?.['state'] === 'revoked' ||
        current?.['lifecycle'] === 'closed' ||
        current?.['status'] === 'retired' ||
        current?.['stale'] === true
      ) {
        blocked.push('当前对象已删除、撤销或失效，不能从旧快照复活。');
      }
      if (kind === 'note' && current?.['readOnly'] === true) {
        blocked.push('当前笔记只读，不能覆盖。');
      }
      if (kind === 'memory_entry' && source['sourceId'] !== current?.['sourceId']) {
        blocked.push('来源已变化，请通过原对象重新核对内容。');
      }
      const patch: Values = Object.fromEntries(FIELDS[kind].map((field) => [field, source[field] ?? null]));
      if (kind === 'agreement') {
        if (source['kind'] === 'term') {
          delete patch['proposedDiff'];
          patch['proposedTerm'] = {
            title: source['title'],
            text: source['text'],
            scope: source['scope'],
            termTier: source['termTier'],
          };
        } else {
          // 第三批约定提议按完整 -/+ 差异确认；恢复只能提议，不能直接覆盖有效约定。
          patch['proposedDiff'] = [
            ...String(current?.['text'] ?? '').split('\n').map((line) => `- ${line}`),
            ...String(source['text']).split('\n').map((line) => `+ ${line}`),
          ].join('\n');
        }
      }
      const before = Object.fromEntries(Object.keys(patch).map((key) => [key, current?.[key] ?? null]));
      return { patch, before, blocked, fields: Object.keys(patch) };
    },
    apply(kind: BackupObjectKind, id: string, version: number, patch: Values, proof: DeviceConfirmation): number {
      const change = {
        actor: 'user' as const,
        actorRef: proof.deviceId,
        reason: '设备确认后从本机备份恢复可编辑内容',
        reasonKind: 'user_correction' as const,
      };
      switch (kind) {
        case 'note':
          return notes.save(id, version, { markdown: String(patch['markdown']) }).version;
        case 'agreement':
          return createAgreementStore(context).update(
            id,
            version,
            checked(AgreementPatchSchema, patch, 'invalid_input', '约定提议恢复'),
            change,
          ).version;
        case 'memory_entry':
          return createMemoryStore(context).update(
            id,
            version,
            checked(MemoryEntryPatchSchema, patch, 'invalid_input', '记忆恢复'),
            change,
          ).version;
      }
    },
    /** 恢复笔记引用的缺失图片；已有但不同的文件不覆盖。 */
    restoreAssets(snapshotDirectory: string, markdown: string): void {
      for (const match of markdown.matchAll(/(?:\/v2\/notes\/assets\/|(?:\.\/)?assets\/)([^\s)"'<>]+)/g)) {
        const name = decodeURIComponent(match[1] ?? '');
        const source = readFileSync(safeBackupPath(snapshotDirectory, `notes/assets/${name}`));
        const current = notes.readAsset(name);
        if (current !== undefined && !current.data.equals(source)) {
          throw new StateError('version_conflict', '笔记图片已有不同内容，不能覆盖。');
        }
        if (current === undefined) {
          writePrivate(safeBackupPath(notesDirectory, `assets/${name}`), source);
        }
      }
    },
  };
}
