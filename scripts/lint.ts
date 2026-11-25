/**
 * Applies `lint-rules.ts` to the specified files, or to the entire repository when no paths are passed.
 * Exits with code 1 when any error is reported; warnings are printed without failing.
 */

import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CommentStyle, isMilestoneName, isTestFile, lintSource } from './lint-rules.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOT_DIR = resolve(ROOT);
const SKIPPED_DIRS = new Set(['.git', '.build', 'node_modules', 'dist', 'coverage', 'vendor', 'bin', 'obj']);
const SKIPPED_ROOT_DIRS = new Set(['.claude', '.agents', 'docs', 'skills-store']);
const LOCAL_FILE = join(ROOT, 'scripts/lint-local.json');
const LOCAL_LONG_FILES: Record<string, string> = existsSync(LOCAL_FILE)
  ? (JSON.parse(readFileSync(LOCAL_FILE, 'utf8')) as { longFiles?: Record<string, string> }).longFiles ?? {}
  : {};
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const COMMENT_STYLES: Readonly<Record<string, CommentStyle>> = {
  '.css': 'css',
  '.swift': 'c-doc-slash',
  '.cs': 'c-doc-slash',
  '.py': 'python',
  '.sh': 'hash',
  '.ps1': 'hash',
  '.yml': 'hash',
  '.yaml': 'hash',
  '.service': 'hash',
  '.timer': 'hash',
  '.conf': 'hash',
  '.html': 'html',
  '.nsh': 'nsis',
};

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !(dir === ROOT_DIR && SKIPPED_ROOT_DIRS.has(entry.name))) {
        yield* walk(join(dir, entry.name));
      }
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

async function main(): Promise<number> {
  let errors = 0;
  let warnings = 0;
  const paths = [...new Set(process.argv.slice(2).map((path) => resolve(ROOT, path)))];
  for await (const file of paths.length > 0 ? paths : walk(ROOT_DIR)) {
    const name = file.split(/[\\/]/).at(-1) ?? '';
    const extension = extname(file);
    const isCode = CODE_EXTENSIONS.has(extension);
    const commentStyle = COMMENT_STYLES[extension] ?? (name === 'Caddyfile' ? 'hash' : undefined);
    if (!isCode && commentStyle === undefined) {
      continue;
    }
    const path = relative(ROOT, file).replaceAll('\\', '/');
    const source = await readFile(file, 'utf8');
    const longReason = LOCAL_LONG_FILES[path];
    const findings = lintSource(source, {
      checkCode: isCode,
      isTest: isTestFile(path),
      isCss: extension === '.css',
      ...(commentStyle === undefined ? {} : { commentStyle }),
      path,
      ...(longReason === undefined ? {} : { longReason }),
    });
    if (isMilestoneName(path)) {
      findings.unshift({
        line: 1,
        rule: 'file-name',
        message: 'File names must describe responsibility rather than milestones or batches',
        severity: 'error',
      });
    }
    for (const finding of findings) {
      if (finding.severity === 'error') {
        errors += 1;
      } else {
        warnings += 1;
      }
      const label = finding.severity === 'error' ? '' : ' (warning)';
      console.error(`${path}:${finding.line}  ${finding.rule}${label}  ${finding.message}`);
    }
  }
  if (errors > 0) {
    console.error(`lint: ${errors} error(s)${warnings > 0 ? `, ${warnings} warning(s)` : ''}`);
    return 1;
  }
  console.log(warnings > 0 ? `lint: passed (${warnings} warning(s))` : 'lint: passed');
  return 0;
}

process.exitCode = await main();
