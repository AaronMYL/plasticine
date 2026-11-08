// Version history: one `versions` row per change to a core object, holding what the object looked like right after.
// This is the 来路 of a judgment and the 用户编辑记录 of a memory entry (《从零方案》第 4 节); a user edit, a model
// proposal and a device-confirmed write are told apart by `actor` and the confirmation columns.

import { randomUUID } from 'node:crypto';
import {
  VersionEntrySchema,
  type Change,
  type DeviceConfirmation,
  type ObjectType,
  type VersionEntry,
} from '../../shared/state.ts';
import { encodeRow, readRow, sqlColumns, type ColumnMap } from './codec.ts';
import type { Database } from './db.ts';

const VERSION_COLUMNS: ColumnMap = {
  id: 'text',
  objectType: 'text',
  objectId: 'text',
  version: 'integer',
  actor: 'text',
  actorRef: 'text',
  reason: 'text',
  reasonKind: 'text',
  fields: 'json',
  snapshot: 'json',
  confirmedByDeviceId: 'text',
  confirmedByDeviceAt: 'text',
  migratedDefault: 'boolean',
  legacyPayload: 'json',
  createdAt: 'text',
};
const INSERT_SQL = (() => {
  const { names, placeholders } = sqlColumns(VERSION_COLUMNS);
  return `INSERT INTO versions (${names}) VALUES (${placeholders})`;
})();

export interface VersionRecord {
  objectType: ObjectType;
  objectId: string;
  version: number;
  change: Change;
  fields: readonly string[];
  snapshot: Readonly<Record<string, unknown>>;
  confirmation: DeviceConfirmation | undefined;
  migratedDefault: boolean;
  createdAt: string;
}

/** Must run inside the transaction that wrote the object, so an object never changes without its version row. */
export function recordVersion(db: Database, record: VersionRecord): void {
  // The legacy payload can be a whole old transcript; history keeps the converted object only.
  const { legacyPayload: _omitted, ...snapshot } = record.snapshot;
  const entry: VersionEntry = {
    id: randomUUID(),
    objectType: record.objectType,
    objectId: record.objectId,
    version: record.version,
    actor: record.change.actor,
    actorRef: record.change.actorRef ?? null,
    reason: record.change.reason,
    reasonKind: record.change.reasonKind ?? null,
    fields: [...record.fields],
    snapshot,
    confirmedByDeviceId: record.confirmation?.deviceId ?? null,
    confirmedByDeviceAt: record.confirmation?.confirmedAt ?? null,
    migratedDefault: record.migratedDefault,
    legacyPayload: null,
    createdAt: record.createdAt,
  };
  db.run(INSERT_SQL, encodeRow(VERSION_COLUMNS, entry));
}

/** Oldest first. */
export function listVersions(db: Database, objectType: ObjectType, objectId: string): VersionEntry[] {
  const rows = db.all(
    'SELECT * FROM versions WHERE object_type = $object_type AND object_id = $object_id ORDER BY version',
    { object_type: objectType, object_id: objectId },
  );
  return rows.map((row) => readRow(VersionEntrySchema, VERSION_COLUMNS, row, 'versions'));
}

// Read in pages so a long absence (回来四句话) never loads the whole history at once; every page is read.
const SINCE_PAGE = 500;

export function createVersionReader(db: Database) {
  return {
    list: (objectType: ObjectType, objectId: string): VersionEntry[] => listVersions(db, objectType, objectId),
    /** Every change of one object type recorded at or after `since`, oldest first (M4: 回来四句话、十件事). */
    since(objectType: ObjectType, since: string): VersionEntry[] {
      const sql = `SELECT * FROM versions WHERE object_type = $object_type AND created_at >= $since
        ORDER BY created_at, object_id, version LIMIT $limit OFFSET $offset`;
      const entries: VersionEntry[] = [];
      for (let offset = 0; ; offset += SINCE_PAGE) {
        const rows = db.all(sql, { object_type: objectType, since, limit: SINCE_PAGE, offset });
        entries.push(...rows.map((row) => readRow(VersionEntrySchema, VERSION_COLUMNS, row, 'versions')));
        if (rows.length < SINCE_PAGE) {
          return entries;
        }
      }
    },
  };
}
