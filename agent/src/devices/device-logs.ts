import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NodeLogUpload } from '../../shared/api/index.ts';

export const DEVICE_LOG_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE = /[^A-Za-z0-9_-]/g;

interface Wanted {
  requestId: string;
  since: string;
  waiters: ((upload: NodeLogUpload | null) => void)[];
}

export interface StoredLogs extends NodeLogUpload {
  nodeId: string;
  receivedAt: string;
}

export class DeviceLogs {
  readonly #directory: string;
  readonly #now: () => Date;
  readonly #wanted = new Map<string, Wanted>();

  constructor(directory: string, now: () => Date) {
    this.#directory = directory;
    this.#now = now;
  }

  wanted(nodeId: string): { requestId: string; since: string } | null {
    const wanted = this.#wanted.get(nodeId);
    return wanted === undefined ? null : { requestId: wanted.requestId, since: wanted.since };
  }

  request(nodeId: string, since: string, waitMs: number, signal?: AbortSignal): Promise<NodeLogUpload | null> {
    const wanted = this.#wanted.get(nodeId) ?? { requestId: `logs-${randomUUID()}`, since, waiters: [] };
    if (since < wanted.since) {
      wanted.since = since;
    }
    this.#wanted.set(nodeId, wanted);
    return new Promise((resolve) => {
      const done = (upload: NodeLogUpload | null): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve(upload);
      };
      const abort = (): void => {
        wanted.waiters = wanted.waiters.filter((waiter) => waiter !== done);
        done(null);
      };
      const timer = setTimeout(abort, waitMs);
      signal?.addEventListener('abort', abort, { once: true });
      wanted.waiters.push(done);
    });
  }

  receive(nodeId: string, upload: NodeLogUpload): void {
    const receivedAt = this.#now().toISOString();
    const folder = join(this.#directory, nodeId.replace(SAFE, '_'));
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const stored: StoredLogs = { nodeId, receivedAt, ...upload };
    writeFileSync(join(folder, `${Date.parse(receivedAt)}-${upload.requestId.replace(SAFE, '_')}.json`),
      JSON.stringify(stored), { mode: 0o600 });
    const wanted = this.#wanted.get(nodeId);
    if (wanted?.requestId === upload.requestId) {
      this.#wanted.delete(nodeId);
      for (const waiter of wanted.waiters) {
        waiter(upload);
      }
    }
    this.purge();
  }

  latest(nodeId: string): StoredLogs | null {
    const folder = join(this.#directory, nodeId.replace(SAFE, '_'));
    let names: string[];
    try {
      names = readdirSync(folder).filter((name) => name.endsWith('.json')).sort();
    } catch {
      return null;
    }
    const last = names.at(-1);
    return last === undefined ? null : JSON.parse(readFileSync(join(folder, last), 'utf8')) as StoredLogs;
  }

  purge(): void {
    const cutoff = this.#now().getTime() - DEVICE_LOG_KEEP_MS;
    let folders: string[];
    try {
      folders = readdirSync(this.#directory);
    } catch {
      return;
    }
    for (const folder of folders) {
      const path = join(this.#directory, folder);
      for (const name of readdirSync(path)) {
        if (statSync(join(path, name)).mtimeMs < cutoff) {
          rmSync(join(path, name), { force: true });
        }
      }
    }
  }
}
