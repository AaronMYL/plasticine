// 安装包里不放的东西（docs/open-source-exclusions.md）：Cyber Hunter 的中心中继是它自己的服务，不在开源版里。
// 清单以那份文档的表格为准，这里只读它。2026-11-05 中继独立成服务以后，app/ 运行时不再 import 它，RELAY_EDITS 是空的；
// 以后真要在打包目录里改源码再往里加，改不上（原文变了）就让构建失败，免得悄悄带出一份 import 了不存在文件的服务。

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const EXCLUSIONS_DOC = 'docs/open-source-exclusions.md';

export interface SourceEdit {
  file: string;
  /** 原文必须恰好出现一次。 */
  find: string;
  replace: string;
}

/** 打包前要在源码副本里改的地方。中继独立以后没有了；排除后的运行时 import 仍由 applyExclusions 兜底检查。 */
export const RELAY_EDITS: readonly SourceEdit[] = [];

/** 文档表格第一列里的路径（反引号包着，一格可以有几条）。 */
export function excludedPaths(markdown: string): string[] {
  const paths: string[] = [];
  for (const line of markdown.split('\n')) {
    // 第一列可以写几条路径（`a`、`b`），每条都算。
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

/** 运行时还 import 被排除文件的地方（`import type` 不算：类型剥离会擦掉）。 */
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

/** 在打包目录里删掉清单上的路径、做 RELAY_EDITS，再确认没有运行时 import 指向它们。 */
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
