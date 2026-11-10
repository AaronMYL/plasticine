import type { StoreContext } from './object-store.ts';
import { notFound } from './errors.ts';

type PurgeTable = 'notes' | 'spaces' | 'books';

export function isPurged(context: StoreContext, table: PurgeTable, id: string): boolean {
  return context.db.get(`SELECT id FROM ${table} WHERE id = $id AND purged_at IS NOT NULL`, { id }) !== undefined;
}

export function requireUnpurged(context: StoreContext, table: PurgeTable, id: string): void {
  if (isPurged(context, table, id)) { throw notFound(table, id); }
}
