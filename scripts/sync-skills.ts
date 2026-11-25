/**
 * Synchronizes `agent/skills/` (source of truth) into `.claude/skills/` (local untracked mirror).
 * Pass `--check` to verify zero drift without writing.
 */

import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = join(ROOT, 'agent', 'skills');
const TARGET = join(ROOT, '.claude', 'skills');

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}

async function listCopy(dir: string): Promise<string[]> {
  try {
    return await listFiles(dir);
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
}

export async function findDrift(source: string, target: string): Promise<string[]> {
  const sourceInfo = await stat(source);
  if (!sourceInfo.isDirectory()) {
    throw new Error(`Skill source ${source} is not a directory`);
  }
  const [sourceFiles, targetFiles] = await Promise.all([listFiles(source), listCopy(target)]);
  if (sourceFiles.length === 0) {
    throw new Error(`Skill source ${source} is empty; refusing to sync`);
  }
  const drift = new Set<string>();
  for (const file of new Set([...sourceFiles, ...targetFiles])) {
    if (!sourceFiles.includes(file) || !targetFiles.includes(file)) {
      drift.add(file);
      continue;
    }
    const [a, b] = await Promise.all([readFile(join(source, file)), readFile(join(target, file))]);
    if (!a.equals(b)) {
      drift.add(file);
    }
  }
  return [...drift].sort();
}

/** Copies into a sibling staging directory before replacing `target` atomically. */
export async function syncSkills(source: string, target: string): Promise<number> {
  await mkdir(dirname(target), { recursive: true });
  const lock = `${target}.sync-lock`;
  try {
    await mkdir(lock);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`Skill mirror ${target} is currently locked by another sync`, { cause: error });
    }
    throw error;
  }
  let staging: string | undefined;
  try {
    const drift = await findDrift(source, target);
    staging = await mkdtemp(`${target}.staging-`);
    await cp(source, staging, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    return drift.length;
  } finally {
    try {
      if (staging !== undefined) {
        await rm(staging, { recursive: true, force: true });
      }
    } finally {
      await rm(lock, { recursive: true });
    }
  }
}

async function main(): Promise<number> {
  if (process.argv.includes('--check')) {
    const drift = await findDrift(SOURCE, TARGET);
    if (drift.length === 0) {
      console.log('skills: .claude/skills matches agent/skills');
      return 0;
    }
    console.error(`skills: .claude/skills drifted (${drift.join(', ')}); run npm run skills:sync`);
    return 1;
  }
  const changed = await syncSkills(SOURCE, TARGET);
  console.log(`skills: synced ${changed} changed file(s)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
