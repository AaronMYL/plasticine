import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

const rel = (path: string): string => relative(SRC, path).replaceAll('\\', '/');
const moduleOf = (path: string): string => path.split('/')[0] ?? '';
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;

test('forbids loose files under agent/src root and requires index.ts in every module', () => {
  const entries = readdirSync(SRC);
  const loose = entries.filter((name) => statSync(join(SRC, name)).isFile());
  assert.deepEqual(loose, [], 'Place source files inside a domain module or util/');
  const missing = entries.filter((name) => statSync(join(SRC, name)).isDirectory()
    && !existsSync(join(SRC, name, 'index.ts')));
  assert.deepEqual(missing, []);
});

test('enforces cross-module imports exclusively through index.ts entrypoints', () => {
  const found: string[] = [];
  for (const path of sourceFiles(SRC)) {
    const file = rel(path);
    const here = moduleOf(file);
    for (const match of readFileSync(path, 'utf8').matchAll(SPECIFIER)) {
      const target = posix.normalize(posix.join(dirname(file), match[2]!));
      if (target.startsWith('..')) continue;
      const owner = moduleOf(target);
      if (owner !== here && target !== `${owner}/index.ts`) found.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(found, [], 'Import from the target module index.ts entrypoint instead');
});

test('forbids intra-module imports through the module own index.ts', () => {
  const found: string[] = [];
  for (const path of sourceFiles(SRC)) {
    const file = rel(path);
    const own = `${moduleOf(file)}/index.ts`;
    if (file === own) continue;
    for (const match of readFileSync(path, 'utf8').matchAll(SPECIFIER)) {
      if (posix.normalize(posix.join(dirname(file), match[2]!)) === own) found.push(file);
    }
  }
  assert.deepEqual(found, [], 'Sibling files within a module must import each other directly');
});

function loadsAlone(path: string): Promise<string | null> {
  const code = `await import(${JSON.stringify(pathToFileURL(path).href)}); process.exit(0);`;
  return new Promise((done) => {
    execFile(process.execPath, ['--input-type=module', '-e', code], { timeout: 60_000 }, (error, _out, err) => {
      done(error ? err.split('\n').find((line) => /Error/.test(line)) ?? String(error) : null);
    });
  });
}

test('loads every module index.ts standalone without circular top-level initialization errors', async () => {
  const modules = readdirSync(SRC).filter((name) => statSync(join(SRC, name)).isDirectory());
  const failed: string[] = [];
  const queue = [...modules];
  const worker = async (): Promise<void> => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const error = await loadsAlone(join(SRC, name, 'index.ts'));
      if (error !== null) failed.push(`${name}/index.ts: ${error}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  assert.deepEqual(failed, [], 'Defer cross-module constant reads inside functions or extract shared constants');
});
