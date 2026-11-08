// Generic create / read / update for one table of versioned rows. Each object file (concerns.ts, tasks.ts …)
// describes its table with a StoreSpec and gets these operations; none of them makes a business decision.
// Every write: confirmed fields refused → input checked against its shared schema → optimistic version check →
// row written → (for core objects) one `versions` row, all inside one transaction.

import type { Static, TSchema } from 'typebox';
import {
  ChangeSchema,
  CreateOptionsSchema,
  PageSchema,
  type Change,
  type CreateOptions,
  type DeviceConfirmation,
  type ObjectType,
  type Page,
  type VersionEntry,
} from '../../shared/state.ts';
import {
  checked,
  columnName,
  decodeRow,
  definedEntries,
  encodeRow,
  normalizeTimes,
  sqlColumns,
  type ColumnMap,
} from './codec.ts';
import { rejectConfirmedFields, requireConfirmation, type ConfirmedRule } from './confirmed-fields.ts';
import type { Database, Params, Row } from './db.ts';
import { fromSqliteError, notFound, StateError, versionConflict } from './errors.ts';
import { listVersions, recordVersion } from './versions.ts';

// 《实施方案》第 5 节：消息分页「往上 50 条」；其余列表用同一页长。
export const DEFAULT_PAGE_SIZE = 50;
// A bigger page belongs in an export or the importer's own query, not in a list call.
export const MAX_PAGE_SIZE = 500;

/** 统一全文索引（《优化清单》第 20 条）在写路径上的那一头：改了一条就在同一个事务里告诉它。 */
export interface SearchIndexHook {
  changed(source: string, ref: string): void;
  materialChanged(kind: 'note' | 'memory_topic' | 'project' | 'space', id: string): void;
  /** 删掉的条目在全文索引的旧分段里还留着词条：把分段合并一遍，真正清掉（「忘掉」之后调）。 */
  purge(): void;
}

export interface StoreContext {
  db: Database;
  now: () => string;
  newId: () => string;
  /** 只在打开的整个状态服务里有；单独测一个 store 时可以不给。 */
  index?: SearchIndexHook;
}

/**
 * Every page of a query, for start-up checks and lists that must not stop at the first page (review-followups:
 * a fixed first 500 silently skipped the rest). node:sqlite is synchronous, so no write lands between two pages.
 */
export function allPages<T>(read: (page: Page) => T[]): T[] {
  const rows: T[] = [];
  for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
    const page = read({ limit: MAX_PAGE_SIZE, offset });
    rows.push(...page);
    if (page.length < MAX_PAGE_SIZE) {
      return rows;
    }
  }
}

export interface StoreSpec<O extends TSchema, I extends TSchema, P extends TSchema, C extends TSchema = TSchema> {
  table: string;
  /** Set for the core objects: every change also writes a `versions` row. */
  objectType?: ObjectType;
  schema: O;
  input: I;
  patch: P;
  confirmedInput?: C;
  /** Every column of the table, meta columns included, keyed by camelCase field name. */
  columns: ColumnMap;
  /** Values for optional non-null fields the caller left out. */
  defaults: Readonly<Record<string, unknown>>;
  confirmed?: readonly ConfirmedRule[];
  /** Only agreements set this (decision 82): old guide sections come over already in effect. */
  migrationImport?: boolean;
  /** Fields computed from the input, e.g. a source's w from its kind. */
  derive?: (values: Readonly<Record<string, unknown>>) => Record<string, unknown>;
  requireReasonKind?: boolean;
  /** 这张表的行收进统一全文索引时的来源名（state/search-sources.ts 登记的）；每次写都在同一事务里更新索引。 */
  searchSource?: string;
}

/** The parts of a StoreSpec these checks look at. */
interface WriteRules {
  table: string;
  objectType?: string | undefined;
  confirmedInput?: TSchema | undefined;
  migrationImport?: boolean | undefined;
}

/** Versioned tables need a valid change record; some also need its reason kind. */
function checkedChange(
  rules: WriteRules,
  change: Change | undefined,
  requireReasonKind: boolean,
): Change | undefined {
  if (rules.objectType === undefined) {
    return change;
  }
  const meta = checked(ChangeSchema, change, 'invalid_input', `${rules.table} 的改动说明`);
  if (requireReasonKind && meta.reasonKind === undefined) {
    const message = `${rules.table} 每次改动都要写原因类别（来路）`;
    throw new StateError('invalid_input', message, { field: 'reasonKind' });
  }
  return meta;
}

/**
 * Confirmed fields carried over from the old system: only for a table that allows it (agreements), only from
 * actor `migration`, only on a row marked migratedDefault. Everything else must go through device confirmation.
 */
function importedFields(
  rules: WriteRules,
  imported: unknown,
  change: Change | undefined,
  options: CreateOptions,
): Record<string, unknown> {
  const { table, confirmedInput } = rules;
  if (rules.migrationImport !== true || confirmedInput === undefined) {
    throw new StateError('invalid_input', `${table} 不接受带确认字段的迁移写入（只有旧指南迁成约定可以）`);
  }
  if (change?.actor !== 'migration' || options.migratedDefault !== true) {
    throw new StateError('invalid_input', `只有迁移能带着确认字段新建 ${table}，而且要标 migratedDefault`);
  }
  const values = checked(confirmedInput, imported, 'invalid_input', `迁移 ${table} 的确认字段`);
  return normalizeTimes(confirmedInput, definedEntries(values as Readonly<Record<string, unknown>>));
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type Filter = Readonly<Record<string, string | number | boolean | null>>;

interface Loaded {
  raw: Record<string, unknown>;
  version: number;
}

export class ObjectStore<O extends TSchema, I extends TSchema, P extends TSchema, C extends TSchema = TSchema> {
  readonly #context: StoreContext;
  readonly #spec: StoreSpec<O, I, P, C>;
  readonly #hasMigrationColumns: boolean;
  readonly #hasConfirmationColumns: boolean;

  constructor(context: StoreContext, spec: StoreSpec<O, I, P, C>) {
    this.#context = context;
    this.#spec = spec;
    this.#hasMigrationColumns = 'migratedDefault' in spec.columns;
    this.#hasConfirmationColumns = 'confirmedByDeviceAt' in spec.columns;
  }

  /**
   * `imported`: confirmed fields carried over from the old system (decision 82), only for a spec with migrationImport,
   * only from actor `migration`, only on a row marked migratedDefault (shown as 「待你确认」).
   */
  create(input: Static<I>, change?: Change, options: CreateOptions = {}, imported?: Static<C>): Static<O> {
    const { table } = this.#spec;
    rejectConfirmedFields(table, this.#spec.confirmed ?? [], input);
    const checkedInput = definedEntries(checked(this.#spec.input, input, 'invalid_input', `新建 ${table}`));
    const values = normalizeTimes(this.#spec.input, checkedInput);
    const extra = checked(CreateOptionsSchema, options, 'invalid_input', `新建 ${table} 的选项`);
    const meta = checkedChange(this.#spec, change, false);
    const carried = imported === undefined ? {} : importedFields(this.#spec, imported, meta, extra);
    const now = this.#context.now();
    const draft: Record<string, unknown> = {
      ...Object.fromEntries(Object.keys(this.#spec.columns).map((field) => [field, null])),
      // A copy: an array default handed back and changed in place must not leak into the next new row.
      ...structuredClone(this.#spec.defaults),
      ...values,
      ...carried,
      ...this.#spec.derive?.(values),
      id: extra.id ?? this.#context.newId(),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const migratedDefault = extra.migratedDefault ?? false;
    if (this.#hasMigrationColumns) {
      draft['migratedDefault'] = migratedDefault;
      draft['legacyPayload'] = extra.legacyPayload ?? null;
    }
    const created = checked(this.#spec.schema, draft, 'invalid_input', `新建 ${table}`);
    const { names, placeholders } = sqlColumns(this.#spec.columns);
    this.#context.db.transaction(() => {
      this.#write(`INSERT INTO ${table} (${names}) VALUES (${placeholders})`, encodeRow(this.#spec.columns, draft));
      const fields = [...Object.keys(values), ...Object.keys(carried)];
      this.#recordVersion(draft, 1, fields, meta, undefined, migratedDefault);
      this.#indexed(draft);
    });
    return created;
  }

  get(id: string): Static<O> | undefined {
    const loaded = this.#load(id);
    return loaded === undefined ? undefined : this.#typed(loaded.raw);
  }

  require(id: string): Static<O> {
    const found = this.get(id);
    if (found === undefined) {
      throw notFound(this.#spec.table, id);
    }
    return found;
  }

  /** Equality filter on scalar columns, oldest first. */
  list(filter: Filter = {}, page: Page = {}): Static<O>[] {
    const clauses: string[] = [];
    const params: Params = {};
    for (const [field, value] of Object.entries(filter)) {
      const kind = this.#spec.columns[field];
      if (kind === undefined || kind === 'json') {
        throw new StateError('invalid_input', `${this.#spec.table} 不能按 ${field} 筛选`, { field });
      }
      const column = columnName(field);
      if (value === null) {
        clauses.push(`${column} IS NULL`);
      } else {
        clauses.push(`${column} = $${column}`);
        params[column] = typeof value === 'boolean' ? Number(value) : value;
      }
    }
    return this.select(clauses.length === 0 ? '1 = 1' : clauses.join(' AND '), params, page);
  }

  /** For the object files' own queries; `where` and `order` are SQL written in state/, never caller text. */
  select(where: string, params: Params, page: Page = {}, order = 'created_at, id'): Static<O>[] {
    const { limit = DEFAULT_PAGE_SIZE, offset = 0 } = checked(PageSchema, page, 'invalid_input', '分页参数');
    if (limit > MAX_PAGE_SIZE) {
      throw new StateError('invalid_input', `一页最多 ${MAX_PAGE_SIZE} 条`, { field: 'limit' });
    }
    const sql = `SELECT * FROM ${this.#spec.table} WHERE ${where} ORDER BY ${order} LIMIT $limit OFFSET $offset`;
    const rows = this.#context.db.all(sql, { ...params, limit, offset });
    return rows.map((row) => this.#typed(decodeRow(this.#spec.columns, row)));
  }

  update(id: string, expectedVersion: number, patch: Static<P>, change?: Change): Static<O> {
    const { table } = this.#spec;
    rejectConfirmedFields(table, this.#spec.confirmed ?? [], patch);
    const checkedPatch = definedEntries(checked(this.#spec.patch, patch, 'invalid_input', `修改 ${table}`));
    const values = normalizeTimes(this.#spec.patch, checkedPatch);
    const meta = checkedChange(this.#spec, change, this.#spec.requireReasonKind ?? false);
    return this.#commit(id, expectedVersion, { ...values, ...this.#spec.derive?.(values) }, meta, undefined);
  }

  /** The only way to write user-confirmed fields: `fields` must hold confirmed fields only. */
  confirm(
    id: string,
    expectedVersion: number,
    fields: Static<C>,
    confirmation: DeviceConfirmation,
    reason: string,
  ): Static<O> {
    const { table, confirmedInput } = this.#spec;
    if (confirmedInput === undefined) {
      throw new StateError('invalid_input', `${table} 没有用户确认字段`);
    }
    const device = requireConfirmation(confirmation);
    const checkedFields = definedEntries(checked(confirmedInput, fields, 'invalid_input', `确认 ${table}`));
    const values = normalizeTimes(confirmedInput, checkedFields);
    // A table whose every change needs its 来路 (judgments) records a confirmation as the user's correction.
    const kind = this.#spec.requireReasonKind === true ? { reasonKind: 'user_correction' } : {};
    const draft = { actor: 'user', actorRef: device.deviceId, reason, ...kind };
    const change = checked(ChangeSchema, draft, 'invalid_input', '确认');
    return this.#commit(id, expectedVersion, values, change, device);
  }

  history(id: string): VersionEntry[] {
    const { objectType } = this.#spec;
    return objectType === undefined ? [] : listVersions(this.#context.db, objectType, id);
  }

  /** Record a user's review without changing the object's content or any confirmed field. */
  acknowledge(id: string, expectedVersion: number, change: Change): Static<O> {
    const meta = checkedChange(this.#spec, change, this.#spec.requireReasonKind ?? false);
    return this.#commit(id, expectedVersion, {}, meta, undefined, true);
  }

  #commit(
    id: string,
    expectedVersion: number,
    values: Record<string, unknown>,
    change: Change | undefined,
    confirmation: DeviceConfirmation | undefined,
    recordUnchanged = false,
  ): Static<O> {
    const { table, columns } = this.#spec;
    return this.#context.db.transaction(() => {
      const current = this.#load(id);
      if (current === undefined) {
        throw notFound(table, id);
      }
      if (current.version !== expectedVersion) {
        throw versionConflict(table, id, expectedVersion, current.version);
      }
      const fields = Object.keys(values).filter((field) => !sameValue(current.raw[field], values[field]));
      if (fields.length === 0 && confirmation === undefined && !recordUnchanged) {
        return this.#typed(current.raw);
      }
      const next: Record<string, unknown> = {
        ...current.raw,
        ...values,
        updatedAt: this.#context.now(),
        version: current.version + 1,
      };
      const written = ['updatedAt', 'version', ...fields];
      if (confirmation !== undefined && this.#hasConfirmationColumns) {
        next['confirmedByDeviceId'] = confirmation.deviceId;
        next['confirmedByDeviceAt'] = confirmation.confirmedAt;
        written.push('confirmedByDeviceId', 'confirmedByDeviceAt');
      }
      const updated = checked(this.#spec.schema, next, 'invalid_input', `修改 ${table}`);
      const assignments = written.map((field) => `${columnName(field)} = $${columnName(field)}`).join(', ');
      const params = encodeRow(Object.fromEntries(written.map((field) => [field, columns[field] ?? 'text'])), next);
      const sql = `UPDATE ${table} SET ${assignments} WHERE id = $id AND version = $expected_version`;
      const changed = this.#write(sql, { ...params, id, expected_version: expectedVersion });
      if (changed !== 1) {
        throw versionConflict(table, id, expectedVersion, this.#load(id)?.version ?? expectedVersion);
      }
      const migrated = next['migratedDefault'] === true;
      this.#recordVersion(next, current.version + 1, fields, change, confirmation, migrated);
      this.#indexed(next);
      return updated;
    });
  }

  #recordVersion(
    snapshot: Record<string, unknown>,
    version: number,
    fields: readonly string[],
    change: Change | undefined,
    confirmation: DeviceConfirmation | undefined,
    migratedDefault: boolean,
  ): void {
    const { objectType } = this.#spec;
    const id = snapshot['id'];
    if (objectType === undefined || change === undefined || typeof id !== 'string') {
      return;
    }
    // The version row carries the same time as the change it records.
    const stamp = snapshot['updatedAt'];
    const createdAt = typeof stamp === 'string' ? stamp : this.#context.now();
    const record = { objectType, objectId: id, version, change, fields, snapshot, confirmation, migratedDefault };
    recordVersion(this.#context.db, { ...record, createdAt });
  }

  #indexed(row: Record<string, unknown>): void {
    const { searchSource } = this.#spec;
    const id = row['id'];
    if (searchSource !== undefined && typeof id === 'string') {
      this.#context.index?.changed(searchSource, id);
    }
  }

  #write(sql: string, params: Params): number {
    try {
      return this.#context.db.run(sql, params);
    } catch (error) {
      throw fromSqliteError(error, `写 ${this.#spec.table}`);
    }
  }

  #load(id: string): Loaded | undefined {
    const row: Row | undefined = this.#context.db.get(`SELECT * FROM ${this.#spec.table} WHERE id = $id`, { id });
    if (row === undefined) {
      return undefined;
    }
    const raw = decodeRow(this.#spec.columns, row);
    const version = raw['version'];
    if (typeof version !== 'number') {
      throw new StateError('corrupt_record', `${this.#spec.table} ${id} 的 version 不是数字`);
    }
    return { raw, version };
  }

  #typed(raw: Record<string, unknown>): Static<O> {
    return checked(this.#spec.schema, raw, 'corrupt_record', `${this.#spec.table} 里的一行不符合 schema`);
  }
}
