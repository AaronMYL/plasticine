// Column fragments shared by the migration files. Applied migrations are history: once a migration that uses one
// of these has shipped, the fragment's text must never change (an edit would make fresh libraries differ from old
// ones). A new shape gets a new constant.

export const RECORD_COLUMNS = `
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1)`;

/** 《实施方案》第 4 节迁移规则 3：迁移来的行标 migrated_default，转不了的原样存 legacy_payload（10-27 第 80 条）。 */
export const MIGRATION_COLUMNS = `
  migrated_default INTEGER NOT NULL DEFAULT 0 CHECK (migrated_default IN (0, 1)),
  legacy_payload TEXT CHECK (legacy_payload IS NULL OR json_valid(legacy_payload))`;

export const OBJECT_COLUMNS = `${RECORD_COLUMNS},${MIGRATION_COLUMNS}`;

/** 用户确认单独一列（《实施方案》第 4 节），连同确认它的设备；两列同时为空或同时有值。 */
export const CONFIRMATION_COLUMNS = `
  confirmed_by_device_id TEXT,
  confirmed_by_device_at TEXT
    CHECK ((confirmed_by_device_at IS NULL) = (confirmed_by_device_id IS NULL))`;

/** `('a', 'b')` for a CHECK … IN list; values are constants written in the migration, never user text. */
export function inList(values: readonly string[]): string {
  return `(${values.map((value) => `'${value}'`).join(', ')})`;
}

export function jsonColumn(name: string, nullable: boolean): string {
  if (nullable) {
    return `${name} TEXT CHECK (${name} IS NULL OR json_valid(${name}))`;
  }
  return `${name} TEXT NOT NULL CHECK (json_valid(${name}))`;
}

export function booleanColumn(name: string, defaultValue: 0 | 1): string {
  return `${name} INTEGER NOT NULL DEFAULT ${defaultValue} CHECK (${name} IN (0, 1))`;
}

export function probabilityColumn(name: string): string {
  return `${name} REAL CHECK (${name} IS NULL OR (${name} >= 0 AND ${name} <= 1))`;
}
