import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { MigrationMode, MigrationSummary } from '../../../shared/api/migration.ts';
import { contentCounts, handleOf, schemaOf, stripSnapshot } from '../../state/index.ts';
import { MigrationWriter } from './format.ts';
import { DATABASE_ITEM, itemsFor, SUMMARY_ITEM } from './layout.ts';

export interface PackFile {
  path: string;
  source: string;
  size: number;
}

export interface PackOptions {
  stateDirectory: string;
  workDirectory: string;
  fileName: string;
  mode: MigrationMode;
  passphrase: string | null;
  snapshot: (path: string) => void;
  now: () => Date;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface PackResult {
  path: string;
  bytes: number;
  summary: MigrationSummary;
}

export async function walk(root: string, prefix: string): Promise<PackFile[]> {
  let info;
  try {
    info = await lstat(root);
  } catch {
    return [];
  }
  if (info.isFile()) {
    return [{ path: prefix, source: root, size: info.size }];
  }
  if (!info.isDirectory()) {
    return [];
  }
  const out: PackFile[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isDirectory() || entry.isFile()) {
      out.push(...await walk(join(root, entry.name), `${prefix}/${entry.name}`));
    }
  }
  return out;
}

export async function packList(stateDirectory: string, mode: MigrationMode): Promise<PackFile[]> {
  const out: PackFile[] = [];
  for (const item of itemsFor(mode)) {
    out.push(...await walk(join(stateDirectory, ...item.split('/')), item));
  }
  return out;
}

export function fileCounts(files: readonly PackFile[]): { files: number; skills: number } {
  const skills = new Set(files.filter((file) => file.path.startsWith('skills/'))
    .map((file) => file.path.split('/')[1] ?? '').filter((name) => name !== '' && !name.startsWith('.')));
  return { files: files.filter((file) => file.path.startsWith('files/')).length, skills: skills.size };
}

function aborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error('导出取消了。');
  }
}

export async function packState(options: PackOptions): Promise<PackResult> {
  const snapshot = join(options.workDirectory, `snapshot-${options.now().getTime()}.sqlite`);
  const target = join(options.workDirectory, options.fileName);
  let writer: MigrationWriter | null = null;
  try {
    options.snapshot(snapshot);
    const handle = handleOf(snapshot);
    stripSnapshot(snapshot, options.mode);
    aborted(options.signal);
    const files = await packList(options.stateDirectory, options.mode);
    const database = (await lstat(snapshot)).size;
    const total = database + files.reduce((sum, file) => sum + file.size, 0);
    const summary: MigrationSummary = {
      format: 'plasticine-migration-v1',
      mode: options.mode,
      exportedAt: options.now().toISOString(),
      handle,
      schema: schemaOf(snapshot),
      counts: { ...contentCounts(snapshot), ...fileCounts(files) },
      bytes: total,
    };
    let done = 0;
    const step = (bytes: number): void => {
      done += bytes;
      options.onProgress?.(done, total);
    };
    writer = await MigrationWriter.create(target, options.mode, options.passphrase);
    await writer.add(SUMMARY_ITEM, Buffer.from(JSON.stringify(summary), 'utf8'));
    await writer.add(DATABASE_ITEM, snapshot, step);
    for (const file of files) {
      aborted(options.signal);
      await writer.add(file.path, file.source, step).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
        step(file.size);
      });
    }
    const bytes = await writer.finish();
    writer = null;
    return { path: target, bytes, summary };
  } catch (error) {
    await writer?.abort();
    await rm(target, { force: true });
    throw error;
  } finally {
    await rm(snapshot, { force: true });
  }
}
