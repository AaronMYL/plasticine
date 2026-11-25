import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const KEEP_COPIES = 2;
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupInput {
  directory: string;
  platform: 'darwin' | 'win32' | 'linux';
  current: string;
  holding: string | null;
  createdAt: Readonly<Record<string, string>>;
  now: Date;
  previous?: string | null;
}

export interface CleanupResult {
  removed: string[];
  previousGone: boolean;
}

function entries(directory: string): string[] {
  return existsSync(directory) ? readdirSync(directory) : [];
}

function createdMs(recorded: string | undefined, path: string): number {
  const parsed = recorded === undefined ? Number.NaN : Date.parse(recorded);
  return Number.isFinite(parsed) ? parsed : statSync(path).mtimeMs;
}

export function cleanUpdates(input: CleanupInput): CleanupResult {
  const { directory, now } = input;
  const removed: string[] = [];
  if (!existsSync(directory)) {
    return { removed, previousGone: false };
  }
  const remove = (relative: string): void => {
    rmSync(join(directory, relative), { recursive: true, force: true });
    removed.push(relative);
  };
  const expired = (created: number): boolean => now.getTime() - created >= KEEP_MS;

  for (const version of entries(join(directory, 'downloads'))) {
    if (version !== input.holding) remove(`downloads/${version}`);
  }
  for (const version of entries(join(directory, 'staging'))) {
    remove(`staging/${version}`);
  }
  for (const name of entries(directory)) {
    if (name.startsWith('started-') && name !== `started-${input.current}`) remove(name);
    const rolledAt = /^rolled-back\.json\.(\d+)$/.exec(name)?.[1];
    if (rolledAt !== undefined && expired(Number(rolledAt))) remove(name);
  }

  let previousGone = false;
  if (input.platform === 'win32') {
    const installers = entries(join(directory, 'installers')).filter((name) => name.endsWith('.exe')).map((name) => {
      const version = name.slice(0, -'.exe'.length);
      return { name, version, created: createdMs(input.createdAt[`installer:${version}`],
        join(directory, 'installers', name)) };
    }).sort((a, b) => b.created - a.created || b.version.localeCompare(a.version, undefined, { numeric: true }));
    const kept = new Set(installers.filter((item) => !expired(item.created)).slice(0, KEEP_COPIES)
      .map((item) => item.version));
    for (const item of installers) {
      if (!kept.has(item.version)) remove(`installers/${item.name}`);
    }
    previousGone = input.previous != null && !kept.has(input.previous);
  } else if (existsSync(join(directory, 'previous'))) {
    const app = join(directory, 'previous', 'Plasticine.app');
    if (!existsSync(app) || expired(createdMs(input.createdAt['previous'], app))) {
      remove('previous');
      previousGone = true;
    }
  }
  return { removed, previousGone };
}
