import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const EXCLUSIONS_DOC = 'docs/open-source-exclusions.md';

export interface SourceEdit {
  file: string;
  find: string;
  replace: string;
}

export const RELAY_EDITS: readonly SourceEdit[] = [];

export function excludedPaths(markdown: string): string[] {
  const paths: string[] = [];
  for (const line of markdown.split('\n')) {
    const cell = /^\|\s*(`[^|]+`)\s*\|/.exec(line)?.[1];
    for (const path of cell === undefined ? [] : cell.matchAll(/`([^`]+)`/g)) {
      if (path[1] !== undefined) {
        paths.push(path[1]);
      }
    }
  }
  if (paths.length === 0) {
    throw new Error(`${EXCLUSIONS_DOC} 里没读到排除清单。`);
  }
  return paths;
}

export function applyEdit(source: string, edit: SourceEdit): string {
  const first = source.indexOf(edit.find);
  if (first === -1 || source.indexOf(edit.find, first + edit.find.length) !== -1) {
    throw new Error(`${edit.file} 里没有恰好一处「${edit.find.trim()}」，排除中继的改动对不上，先更新 exclusions.ts。`);
  }
  return source.slice(0, first) + edit.replace + source.slice(first + edit.find.length);
}

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(path);
    } else if (entry.isFile() && path.endsWith('.ts')) {
      yield path;
    }
  }
}

export function runtimeImportsOf(root: string, excluded: readonly string[]): string[] {
  const names = excluded.map((path) => path.replace(/\/$/, '').split('/').pop() ?? path);
  const found: string[] = [];
  for (const file of sourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)) {
      const target = match[1] ?? '';
      if (names.some((name) => target.includes(`/${name}/`) || target.endsWith(`/${name}`))) {
        found.push(`${relative(root, file).split(sep).join('/')} → ${target}`);
      }
    }
  }
  return found;
}

export function applyExclusions(root: string, markdown: string): string[] {
  const excluded = excludedPaths(markdown);
  for (const path of excluded) {
    const target = join(root, path);
    if (existsSync(target)) {
      rmSync(target, { recursive: statSync(target).isDirectory(), force: true });
    }
  }
  for (const edit of RELAY_EDITS) {
    const file = join(root, edit.file);
    writeFileSync(file, applyEdit(readFileSync(file, 'utf8'), edit));
  }
  const left = runtimeImportsOf(join(root, 'agent'), excluded);
  if (left.length > 0) {
    throw new Error(`排除中继后还有运行时 import 指向它：\n${left.join('\n')}`);
  }
  return excluded;
}
