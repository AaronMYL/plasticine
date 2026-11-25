import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SECRET_SHAPES } from '../scan-tests.ts';

export const INCLUDED_PATHS: readonly string[] = [
  'package.json',
  'package-lock.json',
  'LICENSE',
  'LICENSES',
  'TRADEMARKS.md',
  'agent/package.json',
  'agent/src',
  'agent/builtin-skills',
  'agent/protocol',
  'agent/shared',
  'client/package.json',
  'scripts/maint.ts',
  'scripts/packages/release-manifest.ts',
  'scripts/packages/install-layout.ts',
  'scripts/packages/updater.ts',
  'scripts/packages/update.ts',
  'scripts/packages/linux',
];

const FORBIDDEN_NAMES: readonly RegExp[] = [
  /^\.env(\..*)?$/,
  /credentials.*\.json$/i,
  /\.pem$/,
  /\.key$/,
  /\.sqlite(-wal|-shm)?$/,
];
const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|md|sh|service|timer|env|txt|html|css|yml|yaml)$/;
const MAX_SCANNED_BYTES = 4 * 1024 * 1024;

function* files(directory: string, skip: ReadonlySet<string>): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) {
        yield* files(path, skip);
      }
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

export function auditPackage(root: string): string[] {
  const problems: string[] = [];
  for (const path of files(root, new Set())) {
    const name = path.split(sep).pop() ?? path;
    const shown = relative(root, path).split(sep).join('/');
    if (FORBIDDEN_NAMES.some((pattern) => pattern.test(name))) {
      problems.push(`${shown}：不该进安装包的文件`);
    }
  }
  for (const path of files(root, new Set(['node_modules']))) {
    if (!TEXT_FILE.test(path) || statSync(path).size > MAX_SCANNED_BYTES) {
      continue;
    }
    const source = readFileSync(path, 'utf8');
    for (const shape of SECRET_SHAPES) {
      if (shape.pattern.test(source)) {
        problems.push(`${relative(root, path).split(sep).join('/')}：像真的${shape.name}`);
      }
    }
  }
  return problems;
}
