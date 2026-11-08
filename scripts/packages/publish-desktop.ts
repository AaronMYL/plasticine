// 桌面客户端（Electron 壳，《优化清单》第 14 条）的发布：安装包工作流的发布一步在 publish-packages.ts 之后跑这个，
// 把这一版的桌面包（Mac 的 zip / dmg、Windows 的安装程序）放进同一个版本目录 <根>/<版本>/，再换根上的 desktop.json。
// 不碰 manifest.json：已装的 Linux 更新器、旧 Mac App、Windows 托盘按严格 schema 读它（agent/shared/desktop-release.ts）。
//   node scripts/packages/publish-desktop.ts --artifacts <下载下来的包> --version <版本> --commit <候选 SHA> \
//     [--root /var/www/cyberhunter-download] [--base-url https://cyberhunter.top/download]
// 带版本号的文件只能原样重发；版本目录里已有同名但内容不一样的就拒绝。清单只往新的版本换。

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { DESKTOP_MANIFEST_FILE, parseDesktopManifest, type DesktopReleaseManifest }
  from '../../agent/shared/desktop-release.ts';
import { DEFAULT_PUBLISH_ROOT } from './publish-release.ts';
import { DEFAULT_RELEASE_URL, isNewerVersion, sha256Hex, type ReleaseAsset } from './release-manifest.ts';

const VERSION = /^[0-9]{4}\.[0-9]{3,4}\.[0-9]{5,6}$/;
const FILE_MODE = 0o644;
const DIRECTORY_MODE = 0o755;
const PUBLIC_VERIFY_TIMEOUT_MS = 20_000;

export interface DesktopPublishOptions {
  artifacts: string;
  version: string;
  commit: string;
  root: string;
  baseUrl: string;
  now?: Date;
}

/** 这一版的桌面包文件名（desktop/electron-builder.json 的 artifactName）。 */
export function desktopFiles(version: string): Record<keyof DesktopReleaseManifest['assets'], string> {
  return { mac: `Plasticine-Desktop-mac-${version}.zip`, macDisk: `Plasticine-Desktop-mac-${version}.dmg`,
    windows: `Plasticine-Desktop-Setup-${version}.exe` };
}

function asset(file: string, versionUrl: string): ReleaseAsset {
  const bytes = readFileSync(file);
  const name = basename(file);
  return { name, url: `${versionUrl}${encodeURIComponent(name)}`, sha256: sha256Hex(bytes), size: bytes.length };
}

function current(path: string): DesktopReleaseManifest | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return parseDesktopManifest(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error('现有的 desktop.json 读不懂，没有覆盖。先核对发布点。', { cause: error });
  }
}

export function publishDesktop(options: DesktopPublishOptions): { manifest: string; assets: string[] } | null {
  if (!VERSION.test(options.version) || !/^[a-f0-9]{40}$/.test(options.commit)) {
    throw new Error('版本号或提交不对，没有发布桌面包。');
  }
  const base = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
  if (base.protocol !== 'https:') {
    throw new Error('发布点地址只能是 https。');
  }
  const names = desktopFiles(options.version);
  const present = (Object.keys(names) as (keyof typeof names)[])
    .filter((key) => existsSync(join(options.artifacts, names[key])));
  if (present.length === 0) {
    return null;
  }
  const directory = join(options.root, options.version);
  mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  const versionUrl = new URL(`${options.version}/`, base).href;
  const assets: DesktopReleaseManifest['assets'] = {};
  for (const key of present) {
    const source = join(options.artifacts, names[key]);
    const target = join(directory, names[key]);
    if (existsSync(target)) {
      if (sha256Hex(readFileSync(target)) !== sha256Hex(readFileSync(source))) {
        throw new Error(`${names[key]} 已经发布过，内容不一样：带版本号的文件不能换，请用新的提交重新构建。`);
      }
    } else {
      const temporary = `${target}.partial-${process.pid}`;
      copyFileSync(source, temporary);
      chmodSync(temporary, FILE_MODE);
      renameSync(temporary, target);
    }
    assets[key] = asset(target, versionUrl);
  }
  const manifest = parseDesktopManifest(JSON.stringify({ schema: 1, version: options.version,
    commit: options.commit, publishedAt: (options.now ?? new Date()).toISOString(), assets }));
  const path = join(options.root, DESKTOP_MANIFEST_FILE);
  const existing = current(path);
  if (existing !== null && !isNewerVersion(manifest.version, existing.version)) {
    if (existing.version === manifest.version && existing.commit === manifest.commit
      && isDeepStrictEqual(existing.assets, manifest.assets)) {
      return { manifest: path, assets: present };
    }
    throw new Error(`桌面包 ${manifest.version} 不比已发布的 ${existing.version} 新，或同一版内容不一样，没有换清单。`);
  }
  const temporary = `${path}.partial-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: FILE_MODE });
  chmodSync(temporary, FILE_MODE);
  renameSync(temporary, path);
  return { manifest: path, assets: present };
}

/** 公网上读到的 desktop.json 要和刚落盘的一样，才算发布完成。 */
export async function verifyDesktop(path: string, baseUrl: string, fetcher: typeof fetch = fetch): Promise<void> {
  const expected = parseDesktopManifest(readFileSync(path, 'utf8'));
  const url = new URL(DESKTOP_MANIFEST_FILE, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const response = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(PUBLIC_VERIFY_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`公网 desktop.json 回了 ${response.status}。文件已经落盘，核对中继后原样重试。`);
  }
  if (!isDeepStrictEqual(parseDesktopManifest(await response.text()), expected)) {
    throw new Error('公网 desktop.json 和刚落盘的不一样。核对后原样重试这一版。');
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    artifacts: { type: 'string' }, version: { type: 'string' }, commit: { type: 'string' },
    root: { type: 'string', default: DEFAULT_PUBLISH_ROOT },
    'base-url': { type: 'string', default: DEFAULT_RELEASE_URL },
  } });
  if (values.artifacts === undefined || values.version === undefined || values.commit === undefined) {
    console.error('要给 --artifacts、--version 和 --commit。');
    process.exitCode = 2;
  } else {
    try {
      const result = publishDesktop({ artifacts: values.artifacts, version: values.version, commit: values.commit,
        root: values.root, baseUrl: values['base-url'] });
      if (result === null) {
        console.log(JSON.stringify({ desktop: 'none' }));
      } else {
        await verifyDesktop(result.manifest, values['base-url']);
        console.log(JSON.stringify({ desktop: result.assets, publicVerified: true }));
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
