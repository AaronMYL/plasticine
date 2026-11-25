import { isAbsolute, normalize, sep } from 'node:path';
import type { MigrationMode } from '../../../shared/api/migration.ts';

export const DATABASE_ITEM = 'plasticine.sqlite';
export const DATABASE_SIDE_FILES = ['plasticine.sqlite-wal', 'plasticine.sqlite-shm'] as const;
export const SUMMARY_ITEM = 'summary.json';
export const DATA_ITEMS = ['notes', 'books', 'files', 'files-trash', 'attachments', 'mail', 'skills'] as const;
export const MACHINE_ITEMS = [
  'credentials', 'tunnel', 'web-push-vapid.json', 'mail-image.key', 'cloud-tools/ssh-hosts.json',
] as const;

export const MIGRATION_DIRECTORY = 'migration';
export const EXPORTS_DIRECTORY = 'exports';
export const IMPORTS_DIRECTORY = 'imports';
export const BEFORE_DIRECTORY = 'before';
export const PENDING_FILE = 'pending.json';
export const RESULT_FILE = 'result.json';
export const UPLOAD_FILE = 'upload.plasticine';
export const STAGED_DIRECTORY = 'staged';
export const IMPORT_META_FILE = 'import.json';
export const BEFORE_META_FILE = 'before.json';
export const ADDED_FILE = 'added.json';
export const RESTART_EXIT_CODE = 75;

export function itemsFor(mode: MigrationMode): string[] {
  return mode === 'full' ? [...DATA_ITEMS, ...MACHINE_ITEMS] : [...DATA_ITEMS];
}

export function replacedItems(mode: MigrationMode): string[] {
  return [DATABASE_ITEM, ...DATABASE_SIDE_FILES, ...itemsFor(mode)];
}

export function allowedEntry(path: string, mode: MigrationMode): boolean {
  if (path === '' || path.includes('\\') || path.includes('\0') || isAbsolute(path) || path.startsWith('/')) {
    return false;
  }
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    return false;
  }
  if (normalize(path).split(sep).join('/') !== path) {
    return false;
  }
  if (path === DATABASE_ITEM || path === SUMMARY_ITEM) {
    return true;
  }
  return itemsFor(mode).some((item) => path === item || path.startsWith(`${item}/`));
}
