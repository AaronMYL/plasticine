// 本机原始一致快照：只收库和快照引用的笔记文件。身份数据只留受保护目录，不提供导出下载。
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { userInfo } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { Database } from './db.ts';
import { ASSET_NAME_PATTERN } from './note-bodies.ts';
const Digest = Type.String({ pattern: '^[a-f0-9]{64}$' });
const FileSchema = Type.Object({ path: Type.String(), bytes: Type.Integer({ minimum: 0 }), sha256: Digest });
export const BackupManifestSchema = Type.Object({
  format: Type.Literal('plasticine-local-backup-v1'),
  id: Type.String(),
  createdAt: Type.String(),
  schema: Type.Array(Type.String()),
  applicationBuild: Type.Union([Type.String(), Type.Null()]),
  files: Type.Array(FileSchema),
  missing: Type.Array(Type.String()),
  counts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
});
export type BackupManifest = Static<typeof BackupManifestSchema>;
// 能按对象恢复的三种（2026-11-05 关切、判断、证据、来源、任务的表删掉了）。
export const BACKUP_TABLES = {
  note: 'notes',
  agreement: 'agreements',
  memory_entry: 'memory_entries',
} as const;
export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function safeBackupPath(root: string, name: string): string {
  const path = resolve(root, name);
  const local = relative(resolve(root), path);
  if (local === '' || local.startsWith('..') || isAbsolute(local) || isAbsolute(name)) {
    throw new Error('备份文件路径不在受控目录中。');
  }
  let parent = resolve(root);
  for (const component of ['', ...local.split(sep)]) {
    parent = join(parent, component);
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) {
      throw new Error('备份路径不能含链接。');
    }
  }
  if (
    existsSync(path) &&
    (lstatSync(path).isSymbolicLink() || relative(realpathSync(root), realpathSync(path)).startsWith('..'))
  ) {
    throw new Error('备份文件不能通过链接越过目录。');
  }
  return path;
}
export function privateDirectory(path: string, requireOwner: boolean): void {
  if (requireOwner && (process.platform !== 'linux' || userInfo().username !== 'plasticine')) {
    throw new Error('本机备份必须由 Linux 的 plasticine 用户执行。');
  }
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error('备份目录不能是链接。');
  }
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  const info = lstatSync(path);
  if (process.platform !== 'win32' && ((info.mode & 0o777) !== 0o700 || info.uid !== process.getuid?.())) {
    throw new Error('备份目录权限不符合要求。');
  }
}
export function writePrivate(path: string, bytes: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  chmodSync(path, 0o600);
}
function digestFile(root: string, path: string): Static<typeof FileSchema> {
  const bytes = readFileSync(safeBackupPath(root, path));
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}
export function snapshotFiles(
  db: Database,
  notesDirectory: string,
  directory: string,
  id: string,
  createdAt: string,
  allowIncomplete = false,
): { manifest: BackupManifest; digest: string; bytes: number } {
  const library = join(directory, 'plasticine.sqlite');
  // VACUUM INTO captures a consistent database, including WAL, and refuses an existing destination.
  db.run('VACUUM INTO $path', { path: library });
  chmodSync(library, 0o600);
  const snapshot = new DatabaseSync(library, { readOnly: true });
  const files = new Map<string, Static<typeof FileSchema>>();
  const missing = new Set<string>();
  const readSource = (path: string, relativePath: string): Buffer | null => {
    try {
      return readFileSync(path);
    } catch (cause) {
      if (!allowIncomplete) {
        throw cause;
      }
      missing.add(relativePath);
      return null;
    }
  };
  try {
    const rows = snapshot
      .prepare(
        'SELECT body_file, body_bytes, body_sha256 FROM notes UNION ' +
          'SELECT body_file, body_bytes, body_sha256 FROM note_versions',
      )
      .all();
    for (const row of rows) {
      const file = String(row['body_file']);
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,130}\.md$/.test(file)) {
        throw new Error('笔记路径无效。');
      }
      const bytes = readSource(safeBackupPath(notesDirectory, file), `notes/${file}`);
      if (bytes === null) {
        continue;
      }
      if (bytes.length !== row['body_bytes'] || sha256(bytes) !== row['body_sha256']) {
        if (!allowIncomplete) {
          throw new Error('笔记正文校验失败。');
        }
        missing.add(`notes/${file}`);
      }
      const target = `notes/${file}`;
      if (!files.has(target)) {
        writePrivate(safeBackupPath(directory, target), bytes);
        files.set(target, digestFile(directory, target));
      }
      // 笔记的站内图片按引用收集；不递归读取目录，不读取无关文件。
      const text = bytes.toString('utf8');
      const refs = text.matchAll(/(?:\/v2\/notes\/assets\/|(?:\.\/)?assets\/)([^\s)"'<>]+)/g);
      for (const match of refs) {
        const name = decodeURIComponent(match[1] ?? '');
        if (!ASSET_NAME_PATTERN.test(name)) {
          throw new Error('笔记图片引用无效。');
        }
        const asset = `notes/assets/${name}`;
        if (!files.has(asset)) {
          const source = readSource(safeBackupPath(notesDirectory, `assets/${name}`), asset);
          if (source === null) {
            continue;
          }
          writePrivate(safeBackupPath(directory, asset), source);
          files.set(asset, digestFile(directory, asset));
        }
      }
    }
    files.set('plasticine.sqlite', digestFile(directory, 'plasticine.sqlite'));
    const counts: Record<string, number> = {};
    for (const table of Object.values(BACKUP_TABLES)) {
      counts[table] = Number(snapshot.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.['n']);
    }
    const schema = snapshot
      .prepare('SELECT id FROM schema_migrations ORDER BY id')
      .all()
      .map((row) => String(row['id']));
    const build = snapshot
      .prepare(
        "SELECT json_extract(metadata, '$.buildId') AS id " + 'FROM client_publications ORDER BY rowid DESC LIMIT 1',
      )
      .get()?.['id'];
    const manifest: BackupManifest = {
      format: 'plasticine-local-backup-v1',
      id,
      createdAt,
      schema,
      applicationBuild: typeof build === 'string' ? build : null,
      files: [...files.values()],
      counts,
      missing: [...missing],
    };
    const content = JSON.stringify(manifest);
    writePrivate(join(directory, 'manifest.json'), content);
    return { manifest, digest: sha256(content), bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
  } finally {
    snapshot.close();
  }
}
export function verifyBackupFiles(directory: string, digest: string): BackupManifest {
  const bytes = readFileSync(safeBackupPath(directory, 'manifest.json'));
  const manifest: unknown = JSON.parse(bytes.toString('utf8'));
  if (sha256(bytes) !== digest || !Value.Check(BackupManifestSchema, manifest)) {
    throw new Error('备份清单校验失败。');
  }
  if (!manifest.files.some((file) => file.path === 'plasticine.sqlite')) {
    throw new Error('备份缺少库文件。');
  }
  for (const file of manifest.files) {
    if (file.path !== 'plasticine.sqlite' && !/^notes\/[A-Za-z0-9_./-]+$/.test(file.path)) {
      throw new Error('备份范围不正确。');
    }
    const actual = digestFile(directory, file.path);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) {
      throw new Error('备份文件校验失败。');
    }
  }
  const snapshot = new DatabaseSync(join(directory, 'plasticine.sqlite'), { readOnly: true });
  try {
    if (
      snapshot.prepare('PRAGMA integrity_check').get()?.['integrity_check'] !== 'ok' ||
      snapshot.prepare('PRAGMA foreign_key_check').all().length !== 0
    ) {
      throw new Error('备份库校验失败。');
    }
    for (const table of Object.values(BACKUP_TABLES)) {
      if (snapshot.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.['n'] !== manifest.counts[table]) {
        throw new Error('备份行数校验失败。');
      }
    }
  } finally {
    snapshot.close();
  }
  return manifest;
}
