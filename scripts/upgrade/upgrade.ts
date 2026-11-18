// 依赖自动升级（11-18 Aaron 定：「自动拉清单和PI-AI发版都要」「不能依赖你来做」）。腾讯云的值班程序查 npm，有新版就在
// 本仓库开一条「[升级] …」Issue，正文里带一行 `<!-- upgrade-request {"packages":{…}} -->`；.github/workflows/upgrade.yml
// 只认仓库主人开的，用这里的命令把版本改进 package.json、生成分支名和提交说明，跑全部测试、推分支、留结果。他在 Plasticine
// 卡上点「升级」后，值班程序在那条 Issue 下留「合并 <SHA>」，工作流核对分支还是那个提交才合并、发起构建。
//
//   node scripts/upgrade/upgrade.ts apply      （正文从环境变量 UPGRADE_BODY 读）改好 package.json，打印 JSON
//   node scripts/upgrade/upgrade.ts merge      （评论从 UPGRADE_COMMENT 读）打印要合并的 SHA，不是合并命令就退出码 2
//
// 只改名单里的几个包、只升不降、版本只收 x.y.z；名单外的、格式不对的一律拒绝（Issue 是公开仓库里的，正文不可信）。

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 走自动升级的包，和它写在哪个 package.json（electron 在桌面客户端，不在工作区里，要在 desktop 里单独装）。 */
export const UPGRADABLE: Readonly<Record<string, 'agent' | 'desktop'>> = {
  '@earendil-works/pi-ai': 'agent',
  '@earendil-works/pi-agent-core': 'agent',
  'acme-client': 'agent',
  electron: 'desktop',
};

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/u;
const REQUEST = /<!-- upgrade-request (\{.*?\}) -->/u;
const MERGE = /^合并 ([0-9a-f]{40})\s*$/u;

export class UpgradeError extends Error {}

export interface UpgradeChange { name: string; dir: 'agent' | 'desktop'; from: string; to: string }

function parts(version: string): [number, number, number] {
  const match = VERSION.exec(version);
  if (match === null) {
    throw new UpgradeError(`版本「${version}」不是 x.y.z。`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function newer(next: string, current: string): boolean {
  const [a, b] = [parts(next), parts(current)];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return (a[index] ?? 0) > (b[index] ?? 0);
    }
  }
  return false;
}

/** 正文里那一行请求：{"packages":{"包名":"版本"}}，至少一个、最多四个。 */
export function parseRequest(body: string): Record<string, string> {
  const raw = REQUEST.exec(body)?.[1];
  if (raw === undefined) {
    throw new UpgradeError('正文里没有 upgrade-request 那一行。');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UpgradeError('upgrade-request 那一行不是 JSON。');
  }
  const packages = (value as { packages?: unknown } | null)?.packages;
  if (packages === null || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new UpgradeError('upgrade-request 要有 packages。');
  }
  const entries = Object.entries(packages as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 4) {
    throw new UpgradeError('一次升一到四个包。');
  }
  const result: Record<string, string> = {};
  for (const [name, version] of entries) {
    if (UPGRADABLE[name] === undefined) {
      throw new UpgradeError(`「${name}」不在自动升级的名单里。`);
    }
    if (typeof version !== 'string') {
      throw new UpgradeError(`「${name}」的版本要是字符串。`);
    }
    parts(version);
    result[name] = version;
  }
  return result;
}

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  allowScripts?: Record<string, boolean>;
}

/**
 * 把版本写进 package.json：只升不降、原来就锁死在一个版本上；桌面客户端 allowScripts 里写着「包@旧版本」的一起换。
 * 返回改了什么；装依赖（更新锁文件）由工作流做。
 */
export function applyUpgrade(root: string, packages: Record<string, string>): UpgradeChange[] {
  const changes: UpgradeChange[] = [];
  const manifests = new Map<'agent' | 'desktop', Manifest>();
  for (const [name, to] of Object.entries(packages)) {
    const dir = UPGRADABLE[name] ?? 'agent';
    const manifest = manifests.get(dir)
      ?? JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) as Manifest;
    manifests.set(dir, manifest);
    const table = manifest.dependencies?.[name] !== undefined ? manifest.dependencies : manifest.devDependencies;
    const from = table?.[name];
    if (table === undefined || from === undefined) {
      throw new UpgradeError(`${dir}/package.json 里没有「${name}」。`);
    }
    if (!VERSION.test(from)) {
      throw new UpgradeError(`「${name}」原来写的「${from}」不是锁死的版本，不自动改。`);
    }
    if (!newer(to, from)) {
      throw new UpgradeError(`「${name}」已经是 ${from}，不比 ${to} 旧。`);
    }
    table[name] = to;
    const allowed = manifest.allowScripts?.[`${name}@${from}`];
    if (manifest.allowScripts !== undefined && allowed !== undefined) {
      manifest.allowScripts = Object.fromEntries(Object.entries(manifest.allowScripts)
        .map(([key, flag]) => [key === `${name}@${from}` ? `${name}@${to}` : key, flag]));
    }
    changes.push({ name, dir, from, to });
  }
  for (const [dir, manifest] of manifests) {
    writeFileSync(join(root, dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return changes;
}

function short(name: string): string {
  return name.replace(/^@[^/]+\//u, '');
}

/** 分支名：upgrade/pi-ai-1.5.2（几个包同一版本时只写第一个），只用字母、数字、点、横线。 */
export function branchName(changes: readonly UpgradeChange[]): string {
  const first = changes[0];
  if (first === undefined) {
    throw new UpgradeError('没有要改的。');
  }
  return `upgrade/${short(first.name)}-${first.to}`.replace(/[^A-Za-z0-9./-]/gu, '-');
}

export function commitMessage(changes: readonly UpgradeChange[]): string {
  const names = changes.map((change) => short(change.name)).join('、');
  const lines = changes.map((change) => `- ${change.name}：${change.from} → ${change.to}（${change.dir}）`);
  return `依赖：${names} 升到新版（自动升级）\n\n服务器查到新版、在这里试过，主人在 Plasticine 卡上点了「升级」才合进 main。\n${lines.join('\n')}\n`;
}

/** 「合并 <SHA>」这条评论要合并的提交；别的评论是 null。 */
export function mergeTarget(comment: string): string | null {
  return MERGE.exec(comment.trim())?.[1] ?? null;
}

function main(argv: readonly string[]): number {
  const [command] = argv;
  if (command === 'apply') {
    const changes = applyUpgrade(process.cwd(), parseRequest(process.env['UPGRADE_BODY'] ?? ''));
    console.log(JSON.stringify({ branch: branchName(changes), message: commitMessage(changes),
      dirs: [...new Set(changes.map((change) => change.dir))], changes }));
    return 0;
  }
  if (command === 'merge') {
    const target = mergeTarget(process.env['UPGRADE_COMMENT'] ?? '');
    if (target === null) {
      return 2;
    }
    console.log(target);
    return 0;
  }
  console.error('用法：upgrade.ts apply | merge');
  return 1;
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
