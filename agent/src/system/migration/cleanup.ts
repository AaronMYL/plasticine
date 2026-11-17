// 迁移目录的清理（11-16 设计稿：导出的文件留 24 小时，导入前的那一份留 7 天）：服务启动时和每小时一次。
// 没传完、没选的上传留 24 小时；重启时要用的（pending.json 指着的）不动。

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATION_BEFORE_KEEP_MS, MIGRATION_EXPORT_KEEP_MS } from '../../../shared/api/migration.ts';
import { readPending } from './apply.ts';
import {
  BEFORE_DIRECTORY, BEFORE_META_FILE, EXPORTS_DIRECTORY, IMPORTS_DIRECTORY, MIGRATION_DIRECTORY,
} from './layout.ts';

/** 说明文件里记的时间；没有说明文件（打包到一半重启了）按目录的修改时间算。 */
function bornAt(path: string, file: string, field: string): number {
  const meta = join(path, file);
  if (existsSync(meta)) {
    const value = (JSON.parse(readFileSync(meta, 'utf8')) as Record<string, unknown>)[field];
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
      return Date.parse(value);
    }
  }
  return statSync(path).mtimeMs;
}

function sweep(root: string, keep: ReadonlySet<string>, file: string, field: string, maxAge: number,
  now: number): void {
  if (!existsSync(root)) {
    return;
  }
  for (const id of readdirSync(root)) {
    if (keep.has(id)) {
      continue;
    }
    const path = join(root, id);
    if (now - bornAt(path, file, field) >= maxAge) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

/** keep：正在用的导出、导入编号（不管多久都不删）。 */
export function cleanupMigration(stateDirectory: string, now: Date, keep: readonly string[] = []): void {
  const root = join(stateDirectory, MIGRATION_DIRECTORY);
  const pending = readPending(stateDirectory);
  const held = new Set([...keep, ...(pending === null ? [] : [pending.id])]);
  const at = now.getTime();
  sweep(join(root, EXPORTS_DIRECTORY), held, 'export.json', 'createdAt', MIGRATION_EXPORT_KEEP_MS, at);
  sweep(join(root, IMPORTS_DIRECTORY), held, 'import.json', 'createdAt', MIGRATION_EXPORT_KEEP_MS, at);
  sweep(join(root, BEFORE_DIRECTORY), held, BEFORE_META_FILE, 'at', MIGRATION_BEFORE_KEEP_MS, at);
  rmSync(join(root, 'undone'), { recursive: true, force: true });
}
