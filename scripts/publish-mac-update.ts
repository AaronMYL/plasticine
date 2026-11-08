// 统一安装包发行里的旧 Mac 迁移入口：消费公开 catalog 的同一个 zip，按 App 版本放进状态目录的 downloads/mac/。
// 新版 App 迁移后读公开 catalog；后续日期版若 App 版本没变，明确保留已经验证的迁移包。服务端
// agent/src/app/mac-updates.ts 只读 ZIP 和 latest.json。以服务用户身份落盘，先写 .part 再改名，
// latest.json 最后写：中途失败时 App 拿到的还是上一个包。不碰数据库、不重启服务、不删旧包。
// 版本号来自 mac/Resources/Info.plist 的 CFBundleShortVersionString；不比服务器上的新就不放（App 只认更新的版本）。
// 由 packages 的统一发布入口调用；单独运行此文件不再写 latest。扩展 bridge 标记仍兼容原节点读取 schema。

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, realpathSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { IsoTimeSchema } from '../agent/shared/api/common.ts';
import { MacPackageFileSchema, MacVersionSchema, Sha256HexSchema } from '../agent/shared/api/mac-updates.ts';
import { RELEASE_VERSION_PATTERN } from '../agent/shared/release-manifest.ts';

export interface PublishCommands {
  run(command: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr?: string }>;
  sha256(path: string): Promise<string>;
  /** 把 latest.json 先写到 runner 自己的临时目录，返回路径。 */
  writeTemp(text: string): Promise<string>;
  log(message: string): void;
}

export interface PublishInput {
  zip: string;
  expectedSha256?: string;
  version: string;
  commit: string;
  stateDirectory: string;
  user: string;
  now: () => Date;
  /** 只有公开包已验证后才设置；旧 latest 没有这个标记时不能冒认它是迁移包。 */
  bridge?: MigrationBridge;
}

const MigrationBridgeSchema = Type.Object({ schema: Type.Literal(1),
  releaseVersion: Type.String({ pattern: RELEASE_VERSION_PATTERN }), releaseUrl: Type.String({ minLength: 1 }) },
{ additionalProperties: false });
export type MigrationBridge = Static<typeof MigrationBridgeSchema>;
const PublishedReleaseSchema = Type.Object({ version: MacVersionSchema, sha256: Sha256HexSchema,
  file: MacPackageFileSchema, commit: Type.Optional(Type.String({ pattern: '^[a-f0-9]{40}$' })),
  publishedAt: Type.Optional(IsoTimeSchema), bridge: Type.Optional(MigrationBridgeSchema) });
export type PublishedRelease = Static<typeof PublishedReleaseSchema>;
export interface MacPublishResult {
  status: 'published' | 'unchanged' | 'retained';
  release: PublishedRelease;
}

// 和 shared/api/mac-updates.ts 的 MacVersionSchema、Sha256HexSchema 同一口径（测试核对写出的文件合 schema）。
const VERSION_PATTERN = /^[0-9]+(\.[0-9]+){0,3}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DOWNLOADS = join('downloads', 'mac');
const LATEST = 'latest.json';
export const DEFAULT_MAC_STATE = '/home/plasticine/state/agent';
export const DEFAULT_MAC_USER = 'plasticine';

/** 点分数字比较，位数不齐补 0（和 Mac App 的 AppVersion.isNewer 一样）。 */
export function isNewer(candidate: string, current: string): boolean {
  const left = candidate.split('.').map(Number);
  const right = current.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return false;
}

function checkedBridge(bridge: MigrationBridge): void {
  if (!Value.Check(MigrationBridgeSchema, bridge)) throw new Error('迁移包标记的版本格式不对。');
  const url = new URL(bridge.releaseUrl);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('迁移包的公开发布地址必须是不带凭据的 HTTPS 地址。');
  }
}

/** 已有信息损坏必须停止，不能当成首次发布覆盖。旧版无 commit 仍能升级，但不能声称同版幂等。 */
function parseRelease(text: string): PublishedRelease {
  try {
    const value: unknown = JSON.parse(text);
    if (!Value.Check(PublishedReleaseSchema, value)) throw new Error('字段格式不符。');
    if (value.file !== `Plasticine-${value.version}.zip`) throw new Error('包名和 App 版本不一致。');
    if (value.bridge !== undefined) {
      checkedBridge(value.bridge);
      if (value.commit === undefined) throw new Error('迁移包没有提交来源。');
    }
    return value;
  } catch (error) {
    throw new Error('现有 Mac latest.json 读不懂，没有覆盖。核对原文件后再原样重试。', { cause: error });
  }
}

function sameBridge(left: MigrationBridge | undefined, right: MigrationBridge | undefined): boolean {
  return right === undefined || (left?.releaseVersion === right.releaseVersion
    && left.releaseUrl.replace(/\/$/, '') === right.releaseUrl.replace(/\/$/, ''));
}

export async function publishMacUpdate(input: PublishInput, commands: PublishCommands): Promise<MacPublishResult> {
  const { run, log } = commands;
  async function must(args: string[]): Promise<string> {
    const result = await run('sudo', args);
    if (result.code !== 0) {
      throw new Error(`sudo ${args.join(' ')} 执行失败（${result.code}）：${result.stderr ?? result.stdout}`);
    }
    return result.stdout;
  }
  if (!VERSION_PATTERN.test(input.version)) {
    throw new Error(`版本号「${input.version}」不是点分数字（Info.plist 的 CFBundleShortVersionString）。`);
  }
  if (!COMMIT_PATTERN.test(input.commit)) {
    throw new Error('提交要完整 40 位小写 SHA。');
  }
  if (input.bridge !== undefined) checkedBridge(input.bridge);
  const directory = join(input.stateDirectory, DOWNLOADS);
  const file = `Plasticine-${input.version}.zip`;
  const sha256 = await commands.sha256(input.zip);
  if (!SHA_PATTERN.test(sha256)) throw new Error('输入 zip 的 SHA-256 无效。');
  if (input.expectedSha256 !== undefined && sha256 !== input.expectedSha256) {
    throw new Error('兼容入口收到的 ZIP 与公开 catalog 的 SHA-256 不一致，没有写入。');
  }
  const latestPath = join(directory, LATEST);
  async function exists(path: string): Promise<boolean> {
    const result = await run('sudo', ['-n', 'test', '-e', path]);
    if (result.code !== 0 && (result.code !== 1 || (result.stderr ?? '').trim() !== '')) {
      throw new Error(`读现有 Mac 文件失败，没有覆盖：${result.stderr ?? result.stdout}`);
    }
    return result.code === 0;
  }
  const current = await exists(latestPath)
    ? parseRelease(await must(['-n', '-u', input.user, 'cat', latestPath])) : null;
  if (current !== null) {
    const actual = (await must(['-n', '-u', input.user, 'sha256sum', join(directory, current.file)]))
      .trim().split(/\s+/)[0];
    if (actual !== current.sha256) throw new Error('现存 Mac 包与 latest.json 的校验值不符，没有覆盖。');
  }
  if (current !== null && !isNewer(input.version, current.version)) {
    if (current.version === input.version && current.sha256 === sha256 && current.commit === input.commit
      && sameBridge(current.bridge, input.bridge)) {
      log(`服务器上已经是 ${input.version} 的这个包，没有改动。`);
      return { status: 'unchanged', release: current };
    }
    if (current.version === input.version && current.commit !== input.commit && current.bridge !== undefined
      && input.bridge !== undefined && isNewer(input.bridge.releaseVersion, current.bridge.releaseVersion)
      && current.bridge.releaseUrl.replace(/\/$/, '') === input.bridge.releaseUrl.replace(/\/$/, '')) {
      log(`保留已发布的 Mac 迁移包 ${current.version}（提交 ${current.commit}，SHA-256 ${current.sha256}）；`
        + `本次公开版 ${input.bridge.releaseVersion} 使用自己的 zip，不改旧节点入口。`);
      return { status: 'retained', release: current };
    }
    throw new Error(`版本 ${input.version} 不比服务器上的 ${current.version} 新，或同一版来源不一致。`
      + '同版请用原包原样重试；确需替换旧节点的 App 时，再提高 Info.plist 的 CFBundleShortVersionString。');
  }
  const target = join(directory, file);
  if (!await exists(target)) {
    await must(['-n', 'install', '-d', '-o', input.user, '-g', input.user, '-m', '0750', directory]);
    const part = join(directory, `.${file}.part`);
    await must(['-n', 'install', '-o', input.user, '-g', input.user, '-m', '0640', input.zip, part]);
    await must(['-n', '-u', input.user, 'mv', '-f', part, target]);
  }
  // 上次可能已放好包，只在最后换 latest 时失败；同字节复用，绝不改写已占用的版本文件。
  const landed = (await must(['-n', '-u', input.user, 'sha256sum', target])).trim().split(/\s+/)[0];
  if (landed !== sha256) {
    throw new Error(`落盘的包校验值对不上（${landed ?? '空'} ≠ ${sha256}），没有写 latest.json。`);
  }
  const release: PublishedRelease = { version: input.version, sha256, file, commit: input.commit,
    publishedAt: input.now().toISOString(), ...(input.bridge === undefined ? {} : { bridge: input.bridge }) };
  const temp = await commands.writeTemp(`${JSON.stringify(release, null, 2)}\n`);
  const latestPart = join(directory, `.${LATEST}.part`);
  await must(['-n', 'install', '-o', input.user, '-g', input.user, '-m', '0640', temp, latestPart]);
  await must(['-n', '-u', input.user, 'mv', '-f', latestPart, latestPath]);
  log(`已放上 Mac ${input.version}（${sha256.slice(0, 12)}…，提交 ${input.commit.slice(0, 7)}）。`);
  return { status: 'published', release };
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export const realMacPublishCommands: PublishCommands = {
  run: async (command, args) => {
    const result = spawnSync(command, [...args], { encoding: 'utf8' });
    return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  },
  sha256: hashFile,
  writeTemp: async (text) => {
    const directory = await mkdtemp(join(tmpdir(), 'plasticine-mac-'));
    const path = join(directory, LATEST);
    await writeFile(path, text, { mode: 0o600 });
    return path;
  },
  log: (message) => console.log(message),
};

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  console.error('Mac 发行已并入安装包：请用 scripts/packages/publish-packages.ts 统一发布。');
  process.exitCode = 2;
}
