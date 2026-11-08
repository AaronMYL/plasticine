// 发布点（官方的是 https://cyberhunter.top/download，不建 GitHub Release、不打 pkg-* 标签）。
// 发布机器上跑这个脚本：把这一版的包拷进 <根>/<版本>/，再换根上的 install.sh 和 manifest.json；
// 发布点的网页服务只读地发这个目录。
//   node scripts/packages/publish-release.ts --artifacts <下载下来的包> --version <版本> --commit <候选 SHA> \
//     [--root /var/www/cyberhunter-download] [--base-url https://cyberhunter.top/download]
// 顺序：先放好版本目录（临时名、拷完再改名），再换 install.sh，最后换 manifest.json——清单一换，已装的实例才看到新版。
// 旧版本目录不删（规矩：不删数据；已装的实例可能正下到一半）。带版本号的文件对外缓存一年，同一版只能原样重发。

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { DEFAULT_RELEASE_URL, isNewerVersion, MANIFEST_FILE, manifestUrl, parseReleaseManifest,
  parseServerManifest, sha256Hex, type ReleaseManifest } from './release-manifest.ts';
import { releaseManifest, type ReleaseFiles } from './write-release-manifest.ts';

export const DEFAULT_PUBLISH_ROOT = '/var/www/cyberhunter-download';
const INSTALLER = 'install.sh';
const SERVER_MANIFEST = 'server-manifest.json';
const VERSION = /^[0-9]{4}\.[0-9]{3,4}\.[0-9]{5,6}$/;
// 中继以 cyberhunter 用户读；目录和文件对所有人可读、只有发布的人能写。
const DIRECTORY_MODE = 0o755;
const FILE_MODE = 0o644;
// 沿用发布工作流原先的公网检查时限；失败要让发布任务失败，不能只算本机文件已放好。
const PUBLIC_VERIFY_TIMEOUT_MS = 20_000;

export interface PublishOptions {
  /** 工作流下载下来的这一版：四个包和 server-manifest.json。 */
  artifacts: string;
  version: string;
  /** 发布工作流请求的候选 SHA；不能仅凭文件名认领别的提交的产物。 */
  commit?: string;
  root: string;
  baseUrl: string;
  now?: Date;
}

/** 这一版的四个包（安装包工作流的文件名）；少一个就失败，说清楚少的是哪个。 */
export function releaseFiles(directory: string, version: string): Required<ReleaseFiles> {
  const files = {
    server: join(directory, `plasticine-server-${version}.tar.gz`),
    installer: join(directory, INSTALLER),
    mac: join(directory, `Plasticine-mac-${version}.zip`),
    windows: join(directory, `Plasticine-Setup-${version}.exe`),
  };
  for (const file of Object.values(files)) {
    if (!existsSync(file)) {
      throw new Error(`这一版缺 ${basename(file)}，不发布。`);
    }
  }
  return files;
}

function sameBytes(left: string, right: string): boolean {
  return sha256Hex(readFileSync(left)) === sha256Hex(readFileSync(right));
}

/** 原子换掉一个文件：同目录先写临时文件，改名换上。 */
function replaceFile(source: string, target: string): void {
  const temporary = `${target}.partial-${process.pid}`;
  copyFileSync(source, temporary);
  chmodSync(temporary, FILE_MODE);
  renameSync(temporary, target);
}

/** 版本目录：没有就拷好再改名；已有就要逐个一样（重跑同一版），不一样就拒绝。 */
function placeVersion(files: Required<ReleaseFiles>, directory: string): Required<ReleaseFiles> {
  const placed = {
    server: join(directory, basename(files.server)),
    installer: join(directory, basename(files.installer)),
    mac: join(directory, basename(files.mac)),
    windows: join(directory, basename(files.windows)),
  };
  if (existsSync(directory)) {
    const differs = (Object.keys(files) as (keyof ReleaseFiles)[])
      .filter((key) => !existsSync(placed[key]) || !sameBytes(files[key], placed[key]));
    if (differs.length > 0) {
      throw new Error(`${basename(directory)} 已经发布过，内容不一样（${differs.join('、')}）：带版本号的文件不能换，`
        + '请用新的提交重新构建。');
    }
    return placed;
  }
  const temporary = `${directory}.partial-${process.pid}`;
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(temporary, { mode: DIRECTORY_MODE });
  chmodSync(temporary, DIRECTORY_MODE);
  for (const file of Object.values(files)) {
    const target = join(temporary, basename(file));
    copyFileSync(file, target);
    chmodSync(target, FILE_MODE);
  }
  renameSync(temporary, directory);
  return placed;
}

function currentRelease(path: string): ReleaseManifest | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return parseReleaseManifest(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error('现有发布清单读不懂，没有覆盖。先核对发布点的 manifest.json。', { cause: error });
  }
}

/** 构建完成先后不代表版本先后；同版也不能改写源码来源或下载内容。 */
function checkAdvance(candidate: ReleaseManifest, current: ReleaseManifest | null): void {
  if (current === null || isNewerVersion(candidate.version, current.version)) {
    return;
  }
  if (candidate.version !== current.version) {
    throw new Error(`版本 ${candidate.version} 不比当前发布的 ${current.version} 新，没有切换发布清单。`);
  }
  if (candidate.commit !== current.commit || candidate.nodeVersion !== current.nodeVersion
    || !isDeepStrictEqual(candidate.assets, current.assets)) {
    throw new Error(`${candidate.version} 已经发布过，内容不一样（提交或包信息冲突）：请用新的提交重新构建。`);
  }
}

export function publishRelease(options: PublishOptions): { version: string; manifest: string } {
  if (!VERSION.test(options.version)) {
    throw new Error(`版本号不对：${options.version}`);
  }
  const base = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
  if (base.protocol !== 'https:') {
    throw new Error('发布点地址只能是 https。');
  }
  const serverManifestText = readFileSync(join(options.artifacts, SERVER_MANIFEST), 'utf8');
  const built = parseServerManifest(serverManifestText);
  if (built.version !== options.version) {
    throw new Error(`服务包里的版本是 ${built.version}，和要发布的版本 ${options.version} 对不上。`);
  }
  if (options.commit !== undefined && built.commit !== options.commit) {
    throw new Error('服务包里的提交和请求发布的候选 SHA 对不上，没有发布。');
  }
  const files = releaseFiles(options.artifacts, options.version);
  const versionUrl = new URL(`${options.version}/`, base).href;
  const manifest = releaseManifest(files, serverManifestText, versionUrl, options.now ?? new Date());
  const manifestPath = join(options.root, MANIFEST_FILE);
  const current = currentRelease(manifestPath);
  checkAdvance(manifest, current);
  mkdirSync(options.root, { recursive: true, mode: DIRECTORY_MODE });
  const placed = placeVersion(files, join(options.root, options.version));
  replaceFile(placed.installer, join(options.root, INSTALLER));
  if (current?.version === manifest.version) {
    return { version: current.version, manifest: manifestPath };
  }
  const temporary = `${manifestPath}.partial-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: FILE_MODE });
  chmodSync(temporary, FILE_MODE);
  renameSync(temporary, manifestPath);
  return { version: manifest.version, manifest: manifestPath };
}

/** 本机落盘和公网可下载是两个结果；清单取不到或仍是另一版都不能报告发布完成。 */
export async function verifyPublishedRelease(path: string, releaseUrl: string,
  fetcher: typeof fetch = fetch): Promise<void> {
  const expected = parseReleaseManifest(readFileSync(path, 'utf8'));
  let actual: ReleaseManifest;
  try {
    const response = await fetcher(manifestUrl(releaseUrl), { cache: 'no-store',
      headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(PUBLIC_VERIFY_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    actual = parseReleaseManifest(await response.text());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`公网发布清单验证失败（${detail}）。文件已经落盘，核对中继后原样重试这一版。`, { cause: error });
  }
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error('公网发布清单与本次落盘的不一致。核对版本、提交和包信息后原样重试这一版。');
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    artifacts: { type: 'string' },
    version: { type: 'string' },
    commit: { type: 'string' },
    root: { type: 'string', default: DEFAULT_PUBLISH_ROOT },
    'base-url': { type: 'string', default: DEFAULT_RELEASE_URL },
  } });
  if (values.artifacts === undefined || values.version === undefined || values.commit === undefined) {
    console.error('要给 --artifacts、--version 和 --commit（完整候选 SHA）。');
    process.exitCode = 2;
  } else {
    try {
      const result = publishRelease({ artifacts: values.artifacts, version: values.version, root: values.root,
        commit: values.commit, baseUrl: values['base-url'] });
      await verifyPublishedRelease(result.manifest, values['base-url']);
      console.log(JSON.stringify({ ...result, publicVerified: true }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
