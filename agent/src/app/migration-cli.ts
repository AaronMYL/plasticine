// 服务器上导出、导入（11-16 设计稿：文件太大、网页传不动时）。以服务用户运行（plasticine export / import 包了一层）：
//   PLASTICINE_STATE=… node agent/src/app/migration-cli.ts export [--data-only] <文件>      全部的问两遍口令
//   PLASTICINE_STATE=… node agent/src/app/migration-cli.ts import --merge|--replace <文件>   加了密的问口令
// 脚本里加 --passphrase-stdin 从标准输入读一行口令。导出时服务开着也行（库经 WAL 共享、只读复制）。
// 导入只解开、写好 pending.json，重启服务后在开库前做完（plasticine import 会自己重启）。

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { MIGRATION_PASSPHRASE_MIN, type MigrationSummary } from '../../shared/api/migration.ts';
import { copyDatabase } from '../state/index.ts';
import {
  deriveKey, MigrationFileError, packState, readHeader, readSummary, stageForRestart, TooNewError,
} from '../system/index.ts';
import { DATABASE_FILE } from './config.ts';
import { Cancelled, readHidden, readLine } from './cli-input.ts';

const USAGE = '用法：migration-cli.ts export [--data-only] <文件> | import --merge|--replace <文件>'
  + '（脚本里加 --passphrase-stdin）\n';

function say(text: string): void {
  process.stderr.write(`${text}\n`);
}

async function passphrase(fromStdin: boolean, twice: boolean): Promise<string | null> {
  if (fromStdin) {
    return readLine();
  }
  if (process.stdin.isTTY !== true) {
    say('要在终端里运行（口令不回显）；脚本里用 --passphrase-stdin 从标准输入读一行。');
    return null;
  }
  const first = await readHidden('口令：');
  if (!twice) {
    return first;
  }
  if (first !== await readHidden('再输一遍：')) {
    say('两遍不一样，没导出。');
    return null;
  }
  return first;
}

function counts(summary: MigrationSummary): string {
  const { lines, memory, notes, files, books, spaces, skills } = summary.counts;
  return `对话 ${lines} 段、记忆 ${memory} 条、笔记 ${notes} 篇、文件 ${files} 个、书 ${books} 本、空间 ${spaces} 个、`
    + `技能 ${skills} 个`;
}

async function exportTo(stateDir: string, file: string, dataOnly: boolean, fromStdin: boolean): Promise<number> {
  const target = resolve(file);
  if (existsSync(target)) {
    say(`${target} 已经有了，换个名字。`);
    return 1;
  }
  let secret: string | null = null;
  if (!dataOnly) {
    secret = await passphrase(fromStdin, true);
    if (secret === null) {
      return 1;
    }
    if (Array.from(secret).length < MIGRATION_PASSPHRASE_MIN) {
      say(`口令至少 ${MIGRATION_PASSPHRASE_MIN} 位，没导出。`);
      return 1;
    }
  }
  const work = join(dirname(target), `.plasticine-export-${randomUUID()}`);
  await mkdir(work, { mode: 0o700 });
  try {
    let shown = -1;
    const packed = await packState({
      stateDirectory: stateDir, workDirectory: work, fileName: basename(target), mode: dataOnly ? 'data' : 'full',
      passphrase: secret, snapshot: (path) => copyDatabase(join(stateDir, DATABASE_FILE), path),
      now: () => new Date(),
      onProgress: (done, total) => {
        const percent = total === 0 ? 100 : Math.floor((done / total) * 100);
        if (percent >= shown + 10) {
          shown = percent;
          process.stderr.write(`\r打包 ${percent}%`);
        }
      },
    });
    await rename(packed.path, target);
    say(`\n导出好了：${target}（${(packed.bytes / 1024 ** 2).toFixed(1)} MB；${counts(packed.summary)}）`);
    say(dataOnly ? '只有数据，没加密：自己收好。' : '用口令加密了：口令丢了这个文件就打不开。');
    return 0;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function importFrom(stateDir: string, file: string, how: 'merge' | 'replace', fromStdin: boolean):
  Promise<number> {
  const source = resolve(file);
  const { header } = await readHeader(source);
  let key: Buffer | null = null;
  if (header.kdf !== undefined) {
    const secret = await passphrase(fromStdin, false);
    if (secret === null) {
      return 1;
    }
    key = await deriveKey(secret, header.kdf);
  }
  const summary = await readSummary(source, key);
  say(`来自 ${summary.handle === null ? '另一台' : `@${summary.handle}`}，导出于 ${summary.exportedAt}；${counts(summary)}`);
  say('正在核对、解开……');
  await stageForRestart(stateDir, source, key, how);
  say(how === 'merge' ? '解开了。重启服务后合并进这台（这台的都留着）。'
    : '解开了。重启服务后这台的数据整个换成这一份。');
  say('导入前在这台留一份，7 天内能在设置 · 系统里退回。');
  return 0;
}

async function main(): Promise<number> {
  const stateDir = process.env['PLASTICINE_STATE'];
  if (stateDir === undefined || stateDir === '') {
    say('需要设置 PLASTICINE_STATE（服务的状态目录）。');
    return 2;
  }
  const args = process.argv.slice(2);
  const fromStdin = args.includes('--passphrase-stdin');
  const rest = args.filter((arg) => arg !== '--passphrase-stdin');
  const [command, ...tail] = rest;
  const files = tail.filter((arg) => !arg.startsWith('--'));
  const flags = tail.filter((arg) => arg.startsWith('--'));
  if (command === 'export' && files.length === 1 && flags.every((flag) => flag === '--data-only')) {
    return exportTo(stateDir, files[0]!, flags.includes('--data-only'), fromStdin);
  }
  if (command === 'import' && files.length === 1 && flags.length === 1
    && (flags[0] === '--merge' || flags[0] === '--replace')) {
    return importFrom(stateDir, files[0]!, flags[0] === '--merge' ? 'merge' : 'replace', fromStdin);
  }
  process.stderr.write(USAGE);
  return 2;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof Cancelled) {
    say('取消了。');
  } else if (error instanceof MigrationFileError || error instanceof TooNewError) {
    say(error.message);
  } else {
    say(`没做成：${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
}
