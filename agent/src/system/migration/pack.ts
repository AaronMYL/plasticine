// 打包一份导出（11-16）：库的一致快照（削掉不该带的表）+ 名单里的文件，写成一个 .plasticine。边写边报进度，能取消。

import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { MigrationMode, MigrationSummary } from '../../../shared/api/migration.ts';
import { contentCounts, handleOf, schemaOf, stripSnapshot } from '../../state/index.ts';
import { MigrationWriter } from './format.ts';
import { DATABASE_ITEM, itemsFor, SUMMARY_ITEM } from './layout.ts';

export interface PackFile {
  /** 记录里的路径（用 /）。 */
  path: string;
  source: string;
  size: number;
}

export interface PackOptions {
  stateDirectory: string;
  /** 这一份导出自己的目录（放快照和成品）。 */
  workDirectory: string;
  fileName: string;
  mode: MigrationMode;
  passphrase: string | null;
  /** 把运行中的库一致地复制到这个路径（VACUUM INTO）。 */
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

/** 一个目录下的普通文件（不跟链接、不进 socket 之类），路径按 / 拼。 */
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

/** 名单上的东西都有哪些文件。 */
export async function packList(stateDirectory: string, mode: MigrationMode): Promise<PackFile[]> {
  const out: PackFile[] = [];
  for (const item of itemsFor(mode)) {
    out.push(...await walk(join(stateDirectory, ...item.split('/')), item));
  }
  return out;
}

/** 文件页有几个文件、装了几个技能（摘要里的数）。 */
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
        // 打包途中被删掉的文件（他刚好清了最近删除）跳过；打开前就没了，记录还没开始写。
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
