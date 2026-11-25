import { existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readlinkSync, renameSync, rmSync,
  statSync, symlinkSync, unlinkSync, writeFileSync, readdirSync, writeSync } from 'node:fs';
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
  skipped: string[];
  previousSince?: string | null;
}

export const PREVIOUS_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

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
    skipped: Array.isArray(raw.skipped) ? raw.skipped.filter((item) => typeof item === 'string') : [],
    previousSince: typeof raw.previousSince === 'string' ? raw.previousSince : null };
}

export function writeState(layout: Layout, state: UpdateState): void {
  const temporary = `${layout.stateFile}.next`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, layout.stateFile);
}

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

export function expirePrevious(layout: Layout, now: Date): string | null {
  const previous = pointedVersion(layout.previous);
  if (previous === null) {
    return null;
  }
  const state = readState(layout);
  const recorded = state.previousSince == null ? Number.NaN : Date.parse(state.previousSince);
  const since = Number.isFinite(recorded) ? recorded : lstatSync(layout.previous).mtimeMs;
  if (now.getTime() - since < PREVIOUS_KEEP_MS) {
    return null;
  }
  pointTo(layout, layout.previous, null);
  prune(layout);
  writeState(layout, { ...state, previousSince: null });
  return previous;
}
