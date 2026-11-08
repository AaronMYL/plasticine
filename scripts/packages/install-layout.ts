// Linux 安装包在磁盘上的样子（docs/install-packages.md）：
//   <root>/versions/<版本>/   解开的服务包
//   <root>/current  → versions/<这一版>      systemd 从这里跑
//   <root>/previous → versions/<上一版>      一步回退用
//   <root>/downloads/                        下载中的包（校验通过才解开）
//   <root>/update-state.json                 上次检查的结果、装上就不健康而跳过的版本
// 指针是符号链接，先建 .next 再 rename，换指针是原子的。

import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readlinkSync, renameSync, rmSync, statSync,
  symlinkSync, unlinkSync, writeFileSync, readdirSync, writeSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { MANIFEST_FILE, parseServerManifest, type ServerManifest } from './release-manifest.ts';

export interface Layout {
  root: string;
  versions: string;
  current: string;
  previous: string;
  downloads: string;
  stateFile: string;
  lock: string;
}

export interface UpdateState {
  lastCheckAt: string | null;
  lastResult: string | null;
  /** 装上之后健康检查不过、已经退回的版本；同一版不再自动装。 */
  skipped: string[];
}

// 上一次更新进程被强行结束会留下锁；超过一小时（下载 + 健康检查远用不了这么久）就当它没了。
const STALE_LOCK_MS = 60 * 60 * 1000;

export function layoutOf(root: string): Layout {
  const absolute = resolve(root);
  return {
    root: absolute,
    versions: join(absolute, 'versions'),
    current: join(absolute, 'current'),
    previous: join(absolute, 'previous'),
    downloads: join(absolute, 'downloads'),
    stateFile: join(absolute, 'update-state.json'),
    lock: join(absolute, 'update.lock'),
  };
}

/** 指针指向的版本目录名；没有指针是 null。 */
export function pointedVersion(link: string): string | null {
  try {
    return basename(readlinkSync(link));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** 原子地把指针换到 versions/<version>（相对链接，整个目录挪走也还对）；null 表示删掉指针。 */
export function pointTo(layout: Layout, link: string, version: string | null): void {
  if (version === null) {
    rmSync(link, { force: true });
    return;
  }
  if (!existsSync(join(layout.versions, version))) {
    throw new Error(`没有版本目录 ${version}，指针不换。`);
  }
  const next = `${link}.next`;
  rmSync(next, { force: true });
  symlinkSync(join('versions', version), next);
  renameSync(next, link);
}

export function readServerManifest(directory: string): ServerManifest {
  return parseServerManifest(readFileSync(join(directory, MANIFEST_FILE), 'utf8'));
}

export function readState(layout: Layout): UpdateState {
  if (!existsSync(layout.stateFile)) {
    return { lastCheckAt: null, lastResult: null, skipped: [] };
  }
  const raw = JSON.parse(readFileSync(layout.stateFile, 'utf8')) as Partial<UpdateState>;
  return { lastCheckAt: raw.lastCheckAt ?? null, lastResult: raw.lastResult ?? null,
    skipped: Array.isArray(raw.skipped) ? raw.skipped.filter((item) => typeof item === 'string') : [] };
}

export function writeState(layout: Layout, state: UpdateState): void {
  const temporary = `${layout.stateFile}.next`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, layout.stateFile);
}

/** 同一时间只有一个更新在跑；返回释放函数。 */
export function acquireLock(layout: Layout, now: Date): () => void {
  mkdirSync(layout.root, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(layout.lock, 'wx', 0o600);
      writeSync(fd, `${process.pid} ${now.toISOString()}\n`);
      closeSync(fd);
      return () => rmSync(layout.lock, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      if (now.getTime() - statSync(layout.lock).mtimeMs < STALE_LOCK_MS) {
        throw new Error('另一个更新正在进行，这次不做。', { cause: error });
      }
      unlinkSync(layout.lock);
    }
  }
  throw new Error('拿不到更新锁。');
}

/** 只留 current 和 previous 指着的版本，其余版本目录和下载残留都删掉。 */
export function prune(layout: Layout): string[] {
  const keep = new Set([pointedVersion(layout.current), pointedVersion(layout.previous)]);
  const removed: string[] = [];
  if (existsSync(layout.versions)) {
    for (const entry of readdirSync(layout.versions)) {
      if (!keep.has(entry)) {
        rmSync(join(layout.versions, entry), { recursive: true, force: true });
        removed.push(entry);
      }
    }
  }
  rmSync(layout.downloads, { recursive: true, force: true });
  return removed;
}
