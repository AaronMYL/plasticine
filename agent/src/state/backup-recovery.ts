import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { BackupSchema } from '../../shared/api/backups.ts';
import { Database } from './db.ts';
import { checked } from './codec.ts';
import { privateDirectory, safeBackupPath, snapshotFiles, verifyBackupFiles, writePrivate } from './backup-files.ts';
import { sanitizeRecoveredDatabase } from './backup-recovery-sanitize.ts';
import { replayLibraryPurges } from './backup-recovery-purges.ts';
interface Options {
  stateDirectory: string;
  backupId: string;
  destination: string;
  enforceOwner?: boolean;
}
/** 不覆盖当前目录。生成供停服核对的全新恢复目录和当前安全快照；应用拒绝直接启动未核对目录。 */
export function prepareOfflineRestore(options: Options): { restoredDirectory: string; safetyDirectory: string } {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(options.backupId)) {
    throw new Error('备份标识无效。');
  }
  const sourceDirectory = resolve(options.stateDirectory);
  const destination = resolve(options.destination);
  if (existsSync(destination)) {
    throw new Error('恢复目标已存在，不覆盖。');
  }
  const original = new Database(
    new DatabaseSync(join(sourceDirectory, 'plasticine.sqlite'), { readOnly: true }),
    undefined,
  );
  try {
    const row = original.get('SELECT metadata FROM backups WHERE id = $id', { id: options.backupId });
    const backup = checked(BackupSchema, JSON.parse(String(row?.['metadata'])), 'invalid_input', '离线恢复备份');
    if (backup.status !== 'ready' || backup.manifestDigest === null) {
      throw new Error('备份未就绪。');
    }
    const source = safeBackupPath(join(sourceDirectory, 'backups'), backup.id);
    const manifest = verifyBackupFiles(source, backup.manifestDigest);
    if (manifest.missing.length > 0) {
      throw new Error('备份原件不全，不能作为整库恢复来源。');
    }
    const latest = original.all('SELECT id FROM schema_migrations ORDER BY id').map((item) => String(item['id']));
    if (manifest.schema.some((id) => !latest.includes(id))) {
      throw new Error('恢复库结构比当前程序更新。');
    }
    privateDirectory(destination, options.enforceOwner ?? false);
    const restoredDirectory = join(destination, 'restored');
    const safetyDirectory = join(destination, 'current-state');
    mkdirSync(restoredDirectory, { mode: 0o700 });
    mkdirSync(safetyDirectory, { mode: 0o700 });
    const at = new Date().toISOString();
    const safety = snapshotFiles(original, join(sourceDirectory, 'notes'), safetyDirectory, randomUUID(), at, true);
    verifyBackupFiles(safetyDirectory, safety.digest);
    for (const file of manifest.files) {
      writePrivate(safeBackupPath(restoredDirectory, file.path), readFileSync(safeBackupPath(source, file.path)));
    }
    const recovered = new Database(new DatabaseSync(join(restoredDirectory, 'plasticine.sqlite')), undefined);
    try {
      replayLibraryPurges(recovered, original, restoredDirectory, at);
      const laterObjects = sanitizeRecoveredDatabase(recovered, original, restoredDirectory, at);
      if (
        recovered.get('PRAGMA integrity_check')?.['integrity_check'] !== 'ok' ||
        recovered.all('PRAGMA foreign_key_check').length > 0
      ) {
        throw new Error('恢复副本校验失败。');
      }
      writePrivate(
        join(restoredDirectory, 'restore-review.json'),
        JSON.stringify(
          {
            backupId: backup.id,
            backupDigest: backup.manifestDigest,
            createdAt: at,
            laterObjects,
            safetyDigest: safety.digest,
            missingCurrentFiles: safety.manifest.missing,
            status: 'needs_operator_review',
            next: '先停服务，逐项核对较新数据及删除，重新配对；保留原库和 current-state 后再人工切换。',
          },
          null,
          2,
        ),
      );
    } finally {
      recovered.close();
    }
    return { restoredDirectory, safetyDirectory };
  } finally {
    original.close();
  }
}
