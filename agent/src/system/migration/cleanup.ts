import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATION_BEFORE_KEEP_MS, MIGRATION_EXPORT_KEEP_MS } from '../../../shared/api/migration.ts';
import { readPending } from './apply.ts';
import {
  BEFORE_DIRECTORY, BEFORE_META_FILE, EXPORTS_DIRECTORY, IMPORTS_DIRECTORY, MIGRATION_DIRECTORY,
} from './layout.ts';

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
