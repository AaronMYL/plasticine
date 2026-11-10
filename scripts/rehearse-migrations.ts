// 只读源库，先做一致性快照，再在全新目录演练迁移；不改源库、不启动服务、不删除演练文件。
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, type Database } from '../agent/src/state/db.ts';
import { migrate, MIGRATIONS } from '../agent/src/state/migrations/index.ts';

function counts(db: Database): Record<string, number> {
  const names = db.all("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  return Object.fromEntries(names.map((row) => {
    const name = String(row['name']);
    return [name, Number(db.get(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`)?.['n'])];
  }));
}

export async function rehearseMigrations(sourcePath: string, destination: string) {
  const directory = resolve(destination);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const path = join(directory, 'plasticine.sqlite');
  const source = new DatabaseSync(resolve(sourcePath), { readOnly: true });
  try { await backup(source, path); }
  finally { source.close(); }
  const db = openDatabase(path);
  try {
    const before = counts(db);
    const applied = migrate(db, MIGRATIONS, () => new Date().toISOString());
    const after = counts(db);
    const changed = Object.entries(before).filter(([table, count]) => table !== 'schema_migrations'
      && after[table] !== count).map(([table, count]) => ({ table, before: count, after: after[table] }));
    const foreignKeys = db.all('PRAGMA foreign_key_check');
    const integrity = db.all('PRAGMA integrity_check').map((row) => String(row['integrity_check']));
    const repeated = migrate(db, MIGRATIONS, () => new Date().toISOString());
    const passed = changed.length === 0 && foreignKeys.length === 0
      && integrity.length === 1 && integrity[0] === 'ok' && repeated.length === 0;
    const report = { passed, applied, unchangedRows: changed.length === 0, rowChanges: changed,
      foreignKeyErrors: foreignKeys.length, integrity, repeated, before, after };
    await writeFile(join(directory, 'migration-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    if (!passed) throw new Error('迁移副本核对未通过，检查 migration-report.json；源库未改动。');
    return report;
  } finally { db.close(); }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, destination] = process.argv.slice(2);
  if (source === undefined || destination === undefined) {
    throw new Error('用法：rehearse-migrations.ts 源库路径 全新演练目录');
  }
  const report = await rehearseMigrations(source, destination);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
