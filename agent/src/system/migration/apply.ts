// 服务启动时、开库之前做重启前选好的那件事（11-16）：替换、合并或退回。库这时没有别的连接，文件也没人在写。
// 每一步都能重来：做到一半断电，下次启动照着 pending.json 接着做，不会做两遍、不会丢东西。
//   替换：这台原来的（名单里的东西和库）挪进 before/<编号>/，暂存里的挪进来；只要数据的那份，库里密钥、登录、设备和
//         设置那几张表先换回这台的。
//   合并：库先 VACUUM INTO 一份到 before/<编号>/；并库；暂存里这台没有的文件挪进来（文件页里同名不同内容的改名），
//         挪进来的记进 added.json，退回时删掉。
//   退回：替换的把 before 里的挪回来、现在的扔掉；合并的换回那份库、删掉加进来的文件。

import { createHash } from 'node:crypto';
import {
  lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { MigrationHow, MigrationMode, MigrationResult } from '../../../shared/api/migration.ts';
import { copyDatabase, keepMachineTables, mergeDatabase } from '../../state/index.ts';
import {
  ADDED_FILE, BEFORE_DIRECTORY, BEFORE_META_FILE, DATA_ITEMS, DATABASE_ITEM, DATABASE_SIDE_FILES, IMPORTS_DIRECTORY,
  MIGRATION_DIRECTORY, PENDING_FILE, replacedItems, RESULT_FILE, STAGED_DIRECTORY,
} from './layout.ts';

export interface PendingMigration {
  kind: MigrationHow | 'undo';
  /** 导入那一次的编号（退回时是要退回的那一份的编号）。 */
  id: string;
  mode: MigrationMode;
  handle: string | null;
  exportedAt: string | null;
}

export interface BeforeMeta {
  how: MigrationHow;
  mode: MigrationMode;
  at: string;
  /** 替换前这台没有的（退回时要拿掉）。 */
  absent: string[];
}

function migrationPath(stateDirectory: string, ...parts: string[]): string {
  return join(stateDirectory, MIGRATION_DIRECTORY, ...parts);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function move(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
  renameSync(from, to);
}

export function writePending(stateDirectory: string, pending: PendingMigration): void {
  writeJson(migrationPath(stateDirectory, PENDING_FILE), pending);
}

export function readPending(stateDirectory: string): PendingMigration | null {
  return readJson<PendingMigration>(migrationPath(stateDirectory, PENDING_FILE));
}

export function readResult(stateDirectory: string): MigrationResult | null {
  return readJson<MigrationResult>(migrationPath(stateDirectory, RESULT_FILE));
}

export function readBefore(stateDirectory: string): { id: string; meta: BeforeMeta } | null {
  const root = migrationPath(stateDirectory, BEFORE_DIRECTORY);
  const ids = present(root) ? readdirSync(root) : [];
  const found = ids.map((id) => ({ id, meta: readJson<BeforeMeta>(join(root, id, BEFORE_META_FILE)) }))
    .filter((entry): entry is { id: string; meta: BeforeMeta } => entry.meta !== null)
    .sort((left, right) => right.meta.at.localeCompare(left.meta.at));
  return found[0] ?? null;
}

function replace(stateDirectory: string, pending: PendingMigration, at: string): void {
  const staged = migrationPath(stateDirectory, IMPORTS_DIRECTORY, pending.id, STAGED_DIRECTORY);
  const before = migrationPath(stateDirectory, BEFORE_DIRECTORY, pending.id);
  const metaPath = join(before, BEFORE_META_FILE);
  let meta = readJson<BeforeMeta>(metaPath);
  if (meta === null) {
    const stagedDatabase = join(staged, DATABASE_ITEM);
    if (present(stagedDatabase)) {
      keepMachineTables(stagedDatabase, join(stateDirectory, DATABASE_ITEM), pending.mode);
    }
    const absent = replacedItems(pending.mode).filter((item) => !present(join(stateDirectory, ...item.split('/'))));
    meta = { how: 'replace', mode: pending.mode, at, absent };
    writeJson(metaPath, meta);
  }
  for (const item of replacedItems(pending.mode)) {
    const parts = item.split('/');
    const current = join(stateDirectory, ...parts);
    const incoming = join(staged, ...parts);
    const kept = join(before, ...parts);
    // 原来就有、还没挪走的先挪进 before（原来没有的，现在在的就是换进来的，不动）。
    if (!meta.absent.includes(item) && present(current) && !present(kept)) {
      move(current, kept);
    }
    if (present(incoming) && !present(current)) {
      move(incoming, current);
    }
  }
}

function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** 文件页里同名不同内容的，另一台那份叫「名字（另一台）.后缀」，再撞就加序号。 */
function otherName(path: string): string {
  const extension = extname(path);
  const stem = basename(path, extension);
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? '（另一台）' : `（另一台 ${index}）`;
    const candidate = join(dirname(path), `${stem}${suffix}${extension}`);
    if (!present(candidate)) {
      return candidate;
    }
  }
}

/** 暂存里这台没有的挪进来；记下挪进来的（相对状态目录的路径）。 */
function mergeTree(source: string, target: string, relative: string, rename: boolean, added: string[]): number {
  let kept = 0;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (relative === 'skills' && entry.name.startsWith('.')) {
      continue;
    }
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    const path = `${relative}/${entry.name}`;
    if (!present(to)) {
      move(from, to);
      added.push(path);
    } else if (entry.isDirectory() && lstatSync(to).isDirectory() && relative !== 'skills') {
      kept += mergeTree(from, to, path, rename, added);
    } else if (entry.isFile() && rename && lstatSync(to).isFile() && digestOf(from) !== digestOf(to)) {
      const renamed = otherName(to);
      move(from, renamed);
      added.push(`${relative}/${basename(renamed)}`);
    } else {
      kept += 1;
    }
  }
  return kept;
}

function merge(stateDirectory: string, pending: PendingMigration, at: string): MigrationResult {
  const staged = migrationPath(stateDirectory, IMPORTS_DIRECTORY, pending.id, STAGED_DIRECTORY);
  const before = migrationPath(stateDirectory, BEFORE_DIRECTORY, pending.id);
  const current = join(stateDirectory, DATABASE_ITEM);
  if (!present(join(before, DATABASE_ITEM))) {
    mkdirSync(before, { recursive: true, mode: 0o700 });
    copyDatabase(current, join(before, DATABASE_ITEM));
  }
  writeJson(join(before, BEFORE_META_FILE), { how: 'merge', mode: pending.mode, at, absent: [] } satisfies BeforeMeta);
  const label = pending.handle === null ? '另一台' : `@${pending.handle}`;
  const outcome = mergeDatabase(current, join(staged, DATABASE_ITEM), { at, label });
  const addedPath = join(before, ADDED_FILE);
  const added = readJson<string[]>(addedPath) ?? [];
  let kept = outcome.kept;
  let files = 0;
  let skills = 0;
  for (const item of DATA_ITEMS) {
    const source = join(staged, item);
    if (!present(source)) {
      continue;
    }
    mkdirSync(join(stateDirectory, item), { recursive: true, mode: 0o700 });
    const start = added.length;
    kept += mergeTree(source, join(stateDirectory, item), item, item === 'files', added);
    const fresh = added.slice(start);
    if (item === 'files') {
      files += fresh.length;
    }
    if (item === 'skills') {
      skills += fresh.length;
    }
    writeJson(addedPath, added);
  }
  return { kind: 'merge', at, handle: pending.handle, exportedAt: pending.exportedAt,
    added: { ...outcome.added, files, skills }, kept, error: null };
}

function undo(stateDirectory: string, pending: PendingMigration): void {
  const before = migrationPath(stateDirectory, BEFORE_DIRECTORY, pending.id);
  const meta = readJson<BeforeMeta>(join(before, BEFORE_META_FILE));
  if (meta === null) {
    return;
  }
  const trash = migrationPath(stateDirectory, 'undone', pending.id);
  if (meta.how === 'replace') {
    for (const item of replacedItems(meta.mode)) {
      const parts = item.split('/');
      const current = join(stateDirectory, ...parts);
      const kept = join(before, ...parts);
      if (present(kept) || meta.absent.includes(item)) {
        if (present(current)) {
          move(current, join(trash, ...parts));
        }
        if (present(kept)) {
          move(kept, current);
        }
      }
    }
  } else {
    for (const path of readJson<string[]>(join(before, ADDED_FILE)) ?? []) {
      rmSync(join(stateDirectory, ...path.split('/')), { recursive: true, force: true });
    }
    for (const item of [DATABASE_ITEM, ...DATABASE_SIDE_FILES]) {
      if (present(join(stateDirectory, item))) {
        move(join(stateDirectory, item), join(trash, item));
      }
    }
    move(join(before, DATABASE_ITEM), join(stateDirectory, DATABASE_ITEM));
  }
  rmSync(trash, { recursive: true, force: true });
  rmSync(before, { recursive: true, force: true });
}

/**
 * 有选好的事就做完，返回这一次的结果（也写进 result.json，重启回来给一条提示）；没有就是 null。
 * 做坏了不拦启动（main.ts 记日志接着开库）：结果里写上原因、pending 删掉不再重来；做到一半的能「退回…」。
 */
export function applyPendingMigration(stateDirectory: string, now: () => Date): MigrationResult | null {
  const pending = readPending(stateDirectory);
  if (pending === null) {
    return null;
  }
  const at = now().toISOString();
  const base = { at, handle: pending.handle, exportedAt: pending.exportedAt, added: null, kept: 0, error: null };
  let result: MigrationResult;
  try {
    if (pending.kind === 'replace') {
      replace(stateDirectory, pending, at);
      result = { kind: 'replace', ...base };
    } else if (pending.kind === 'merge') {
      result = merge(stateDirectory, pending, at);
    } else {
      undo(stateDirectory, pending);
      result = { kind: 'undo', ...base };
    }
  } catch (error) {
    // 做坏了不反复重来：记下来让他看到；做到一半的，导入前那一份还在，「退回…」能回去。
    const kept = pending.kind !== 'undo'
      && present(migrationPath(stateDirectory, BEFORE_DIRECTORY, pending.id, BEFORE_META_FILE));
    writeJson(migrationPath(stateDirectory, RESULT_FILE), { kind: pending.kind, ...base,
      error: kept ? '这次没做完。要回到导入前，点「退回…」。' : '这次没做成，这台的数据没动。' } satisfies MigrationResult);
    rmSync(migrationPath(stateDirectory, PENDING_FILE), { force: true });
    throw error;
  }
  rmSync(migrationPath(stateDirectory, IMPORTS_DIRECTORY, pending.id), { recursive: true, force: true });
  writeJson(migrationPath(stateDirectory, RESULT_FILE), result);
  rmSync(migrationPath(stateDirectory, PENDING_FILE), { force: true });
  return result;
}
