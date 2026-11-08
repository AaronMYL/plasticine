// 服务包里放什么、不放什么，以及打包前的最后一道检查（docs/install-packages.md「怎么构建」）。
// 源码只从提交里取（git archive），工作区里没提交的文件、.env、库文件进不来；再扫一遍像密钥的串和不该出现的文件名。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SECRET_SHAPES } from '../scan-tests.ts';

/**
 * 从提交里取的路径。scripts/maint.ts 是维护入口。
 * agent/skills 是写、审 Plasticine 自己代码的开发技能，不进包（《优化清单》第 1 条：装的是成品，上下文里没有「改自己」）；
 * 以后真有随程序发的内置技能放 agent/builtin-skills，再加进来。部署、发布脚本一律不进包。
 */
export const INCLUDED_PATHS: readonly string[] = [
  'package.json',
  'package-lock.json',
  'agent/package.json',
  'agent/src',
  'agent/shared',
  'client/package.json',
  'scripts/maint.ts',
  'scripts/packages/release-manifest.ts',
  'scripts/packages/install-layout.ts',
  'scripts/packages/updater.ts',
  'scripts/packages/update.ts',
  'scripts/packages/linux',
];

// 和 .gitignore 里「运行时状态、数据快照、密钥」那几行一致：服务包里一个都不能有。
const FORBIDDEN_NAMES: readonly RegExp[] = [
  /^\.env(\..*)?$/,
  /credentials.*\.json$/i,
  /\.pem$/,
  /\.key$/,
  /\.sqlite(-wal|-shm)?$/,
];
// 只扫文本：二进制文件里的随机字节偶尔凑出前缀，没意义。
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

/** 打包目录里不该有的东西；返回空数组才算过。node_modules 只查文件名（第三方源码里的示例串不算我们的密钥）。 */
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
