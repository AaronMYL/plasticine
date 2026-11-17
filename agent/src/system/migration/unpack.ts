// 读一份导进来的 .plasticine（11-16）：核对时只读第一条摘要；选之前在后台整个解进暂存目录、逐条校验，
// 再把暂存里的库升到这份代码的结构。路径只认名单里的，写文件一律新建（不覆盖、不跟链接）。

import { mkdir, open, rm, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Value } from 'typebox/value';
import { MigrationSummarySchema, type MigrationSummary } from '../../../shared/api/migration.ts';
import { unknownMigrations, upgradeStaged } from '../../state/index.ts';
import { MigrationFileError, readArchive, readHeader, type EntrySink } from './format.ts';
import { allowedEntry, DATABASE_ITEM, SUMMARY_ITEM } from './layout.ts';

/** 这一份是更新的版本导出的：这台要先更新。 */
export class TooNewError extends Error {}

const SUMMARY_MAX = 1024 * 1024;

function parseSummary(bytes: Buffer): MigrationSummary {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new MigrationFileError('bad_file', '迁移文件的摘要坏了。');
  }
  if (!Value.Check(MigrationSummarySchema, value)) {
    throw new MigrationFileError('bad_file', '迁移文件的摘要认不出来，可能是更新的版本导出的。');
  }
  if (unknownMigrations(value.schema).length > 0) {
    throw new TooNewError('这一份是新版导出的，这台还是旧版：先在设置 · 系统里更新这台，再导入。');
  }
  return value;
}

function collect(limit: number): { sink: EntrySink; bytes: () => Buffer } {
  const parts: Buffer[] = [];
  let size = 0;
  return {
    sink: {
      write: async (chunk) => {
        size += chunk.length;
        if (size > limit) {
          throw new MigrationFileError('bad_file', '迁移文件的摘要太大。');
        }
        parts.push(Buffer.from(chunk));
      },
      close: async () => undefined,
    },
    bytes: () => Buffer.concat(parts),
  };
}

/** 只读第一条（摘要）。加了密的要给钥匙；口令不对在这里就报。 */
export async function readSummary(file: string, key: Buffer | null): Promise<MigrationSummary> {
  let summary: MigrationSummary | null = null;
  let first = true;
  const held = collect(SUMMARY_MAX);
  await readArchive(file, key, {
    begin: async (path) => {
      if (!first || path !== SUMMARY_ITEM) {
        throw new MigrationFileError('bad_file', '迁移文件第一条不是摘要。');
      }
      first = false;
      return held.sink;
    },
    stop: () => true,
  });
  summary = parseSummary(held.bytes());
  return summary;
}

function fileSink(handle: FileHandle): EntrySink {
  return {
    write: async (chunk) => {
      await handle.write(chunk);
    },
    close: () => handle.close(),
  };
}

export interface StageOptions {
  file: string;
  key: Buffer | null;
  /** 解到这里（不能已存在）。 */
  directory: string;
  /** 读到文件里第几个字节了。 */
  onProgress?: (offset: number) => void;
  signal?: AbortSignal;
}

/** 整个解进暂存目录，每条校验，库升到这份代码的结构；坏了暂存目录删掉。返回摘要。 */
export async function stageArchive(options: StageOptions): Promise<MigrationSummary> {
  const header = (await readHeader(options.file)).header;
  await mkdir(options.directory, { recursive: false, mode: 0o700 });
  let summary: MigrationSummary | null = null;
  let held: ReturnType<typeof collect> | null = null;
  let sawDatabase = false;
  try {
    await readArchive(options.file, options.key, {
      begin: async (path) => {
        if (options.signal?.aborted === true) {
          throw new Error('导入取消了。');
        }
        if (summary === null && held !== null) {
          summary = parseSummary(held.bytes());
          if (summary.mode !== header.mode) {
            throw new MigrationFileError('bad_file', '迁移文件的开头和摘要对不上。');
          }
        }
        if (held === null) {
          if (path !== SUMMARY_ITEM) {
            throw new MigrationFileError('bad_file', '迁移文件第一条不是摘要。');
          }
          held = collect(SUMMARY_MAX);
          return held.sink;
        }
        if (path === SUMMARY_ITEM || !allowedEntry(path, header.mode)) {
          throw new MigrationFileError('bad_file', `迁移文件里有不该有的东西（${path.slice(0, 80)}）。`);
        }
        sawDatabase ||= path === DATABASE_ITEM;
        const target = join(options.directory, ...path.split('/'));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        return fileSink(await open(target, 'wx', 0o600));
      },
      ...(options.onProgress === undefined ? {} : { progress: options.onProgress }),
    });
    if (summary === null && held !== null) {
      summary = parseSummary((held as ReturnType<typeof collect>).bytes());
    }
    if (summary === null || !sawDatabase) {
      throw new MigrationFileError('bad_file', '迁移文件里没有库。');
    }
    upgradeStaged(join(options.directory, DATABASE_ITEM), join(options.directory, 'notes'),
      join(options.directory, 'books'));
    return summary;
  } catch (error) {
    await rm(options.directory, { recursive: true, force: true });
    throw error;
  }
}
