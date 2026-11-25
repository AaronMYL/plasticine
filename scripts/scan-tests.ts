/**
 * Pre-push test scanner guarding against accidental credential-shaped literals and `.only(` calls.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['agent/tests', 'client/tests', 'agent/src', 'agent/protocol', 'client/src', 'scripts'];
const TEST_FILE = /\.test\.tsx?$/;

export const SECRET_SHAPES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'OpenAI-like API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{30,}/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', pattern: /\bxox[abpr]-[A-Za-z0-9-]{20,}/ },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
];
const ONLY_CALL = /\b(?:test|it|describe)(?:\s*\.\s*\w+)*\s*\.\s*only(?:\s*\.\s*\w+)*\s*\(/g;

function walk(directory: string, found: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw new Error(`Failed to read test directory: ${directory}`, { cause: error });
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) {
      continue;
    }
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, found);
    } else if (directory.includes('tests') || TEST_FILE.test(entry)) {
      found.push(path);
    }
  }
}

export function scanTests(roots: readonly string[] = ROOTS): { files: number; problems: string[] } {
  const files: string[] = [];
  for (const root of roots) {
    walk(root, files);
  }
  const problems: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const report = (pattern: RegExp, message: string): void => {
      for (const match of source.matchAll(new RegExp(pattern.source, 'g'))) {
        const line = source.slice(0, match.index).split('\n').length;
        problems.push(`${relative('.', file)}:${line}  ${message}`);
      }
    };
    for (const shape of SECRET_SHAPES) {
      report(shape.pattern, `Resembles live ${shape.name}`);
    }
    report(ONLY_CALL, '.only( skips all other tests');
  }
  return { files: files.length, problems };
}

if (import.meta.main) {
  const { files, problems } = scanTests();
  if (problems.length > 0) {
    console.error(`scan-tests: ${problems.length} issue(s)`);
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`scan-tests: passed (${files} files)`);
  }
}
