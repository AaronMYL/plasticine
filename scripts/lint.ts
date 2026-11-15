// Applies lint-rules.ts to the named files, or the whole repository when none are supplied.
// Exits 1 when an error is found; warnings are only printed.

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMilestoneName, isTestFile, lintSource } from './lint-rules.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOT_DIR = resolve(ROOT);
// 按名字跳过的目录（在哪一层都跳）。vendor：原样打包进来的第三方代码（压缩过），不按本仓库的规矩查。
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', 'vendor']);
// 只在仓库根上跳过的目录：mac 是 Swift 工程，docs 是文档。按名字跳会把 agent/src/skills、client/src/mac 也漏掉。
const SKIPPED_ROOT_DIRS = new Set(['.claude', 'docs', 'mac']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const TEXT_EXTENSIONS = new Set(['.css', '.sh', '.ps1', '.html']);

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
    const extension = extname(file);
    const isCode = CODE_EXTENSIONS.has(extension);
    if (!isCode && !TEXT_EXTENSIONS.has(extension)) {
      continue;
    }
    const path = relative(ROOT, file).replaceAll('\\', '/');
    const source = await readFile(file, 'utf8');
    const findings = lintSource(source,
      { checkCode: isCode, isTest: isTestFile(path), isCss: extension === '.css', path });
    if (isMilestoneName(path)) {
      findings.unshift({ line: 1, rule: 'file-name', message: '文件名不用里程碑、批次：改成说它是什么', severity: 'error' });
    }
    for (const finding of findings) {
      if (finding.severity === 'error') {
        errors += 1;
      } else {
        warnings += 1;
      }
      const label = finding.severity === 'error' ? '' : '（提醒）';
      console.error(`${path}:${finding.line}  ${finding.rule}${label}  ${finding.message}`);
    }
  }
  if (errors > 0) {
    console.error(`lint：${errors} 处问题${warnings > 0 ? `，${warnings} 条提醒` : ''}`);
    return 1;
  }
  console.log(warnings > 0 ? `lint：通过（${warnings} 条提醒）` : 'lint：通过');
  return 0;
}

process.exitCode = await main();
