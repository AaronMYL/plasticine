// 三个安装包共用的发布清单（docs/install-packages.md）：服务包里的 manifest.json 说「我是哪一版」，
// 发布点上的 manifest.json 说「最新是哪一版、每个包在哪、SHA-256 是多少」。Linux 的更新器（updater.ts）、
// Mac App（mac/Sources/Plasticine/release-update.swift）、Windows 托盘（windows/tray/PlasticineTray.cs）都按这一份读。

import { createHash } from 'node:crypto';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { RELEASE_VERSION_PATTERN, type ReleaseAsset } from '../../agent/shared/release-manifest.ts';
export { ReleaseAssetSchema, ReleaseManifestSchema, parseReleaseManifest, type ReleaseAsset, type ReleaseManifest }
  from '../../agent/shared/release-manifest.ts';

/**
 * 发布点（2026-11-05 他定：Release point = cyberhunter.top）：根上放 manifest.json 和 install.sh，每一版的包在
 * <版本>/ 下（scripts/packages/publish-release.ts 写、中继只读地发）。服务包的 manifest.json 记着它（releaseUrl），
 * 已装的实例按那一份查更新。
 */
export const DEFAULT_RELEASE_URL = 'https://cyberhunter.top/download';
/** 安装包随带 / 安装的 Node 版本（Linux install.sh、Mac build.sh、Windows build.ps1 都用这一个，测试核对）。 */
export const PACKAGE_NODE_VERSION = '24.22.1';
/** 服务要求的最低 Node（package.json 的 engines）。 */
export const MINIMUM_NODE = '24.11';
export const MANIFEST_FILE = 'manifest.json';
export const SERVER_PACKAGE = 'plasticine-server';

// 版本号由提交时间（UTC）定：年.月日.时分秒，例如 2026.1105.093012。逐段按数字比，越晚越新，同一提交永远同一版本。
const VERSION_PATTERN = RELEASE_VERSION_PATTERN;

export const ServerManifestSchema = Type.Object({
  schema: Type.Literal(1),
  name: Type.Literal(SERVER_PACKAGE),
  version: Type.String({ pattern: VERSION_PATTERN }),
  commit: Type.String({ pattern: '^[a-f0-9]{40}$' }),
  builtAt: Type.String({ format: 'date-time' }),
  node: Type.String({ minLength: 1 }),
  releaseUrl: Type.String({ minLength: 1 }),
  /** 按 docs/open-source-exclusions.md 拿掉的路径（中继不进安装包）。 */
  excluded: Type.Array(Type.String()),
}, { additionalProperties: false });
export type ServerManifest = Static<typeof ServerManifestSchema>;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** 提交时间 → 版本号（UTC）。 */
export function packageVersion(committedAt: Date): string {
  if (Number.isNaN(committedAt.getTime())) {
    throw new Error('提交时间无效，算不出版本号。');
  }
  const day = `${pad(committedAt.getUTCMonth() + 1, 2)}${pad(committedAt.getUTCDate(), 2)}`;
  const time = `${pad(committedAt.getUTCHours(), 2)}${pad(committedAt.getUTCMinutes(), 2)}`
    + pad(committedAt.getUTCSeconds(), 2);
  return `${committedAt.getUTCFullYear()}.${day}.${time}`;
}

function versionParts(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10));
}

/** 点分数字逐段比较（和 Mac 的 AppVersion.isNewer、Windows 托盘同一规则）。 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const left = versionParts(candidate);
  const right = versionParts(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return false;
}

/** `24.22.1` / `v24.22.1` 满足 `>=24.11` 这种最低要求。 */
export function nodeSatisfies(installed: string, minimum: string): boolean {
  const have = versionParts(installed.replace(/^v/, ''));
  const need = versionParts(minimum.replace(/^>=/, ''));
  return !isNewerVersion(need.join('.'), have.join('.'));
}

export function sameNodeMajor(installed: string, wanted: string): boolean {
  return versionParts(installed.replace(/^v/, ''))[0] === versionParts(wanted.replace(/^v/, ''))[0];
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function firstError(errors: ReturnType<typeof Value.Errors>): string {
  const first = errors[0];
  return first === undefined ? '' : `（${first.instancePath || '/'}：${first.message}）`;
}

export function parseServerManifest(text: string): ServerManifest {
  const raw: unknown = JSON.parse(text);
  if (!Value.Check(ServerManifestSchema, raw)) {
    throw new Error(`服务包的 manifest.json 格式不对${firstError(Value.Errors(ServerManifestSchema, raw))}。`);
  }
  return raw;
}

/** 资源地址：相对地址按清单所在位置解析；只认 https、file，以及测试用的本机 http。 */
export function assetUrl(asset: ReleaseAsset, manifestUrl: string): URL {
  const url = new URL(asset.url, manifestUrl);
  checkReleaseUrl(url);
  return url;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function checkReleaseUrl(url: URL): void {
  const allowed = url.protocol === 'https:' || url.protocol === 'file:'
    || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (!allowed || url.username !== '' || url.password !== '') {
    throw new Error(`发布地址只能是 https（或本机文件）：${url.protocol}//${url.host}`);
  }
}

/** 发布点根地址 + manifest.json。 */
export function manifestUrl(releaseUrl: string): URL {
  const base = new URL(releaseUrl.endsWith('/') ? releaseUrl : `${releaseUrl}/`);
  checkReleaseUrl(base);
  return new URL(MANIFEST_FILE, base);
}
