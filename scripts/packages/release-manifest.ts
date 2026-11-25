import { createHash } from 'node:crypto';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { RELEASE_VERSION_PATTERN, type ReleaseAsset } from '../../agent/shared/release-manifest.ts';
export { ReleaseAssetSchema, ReleaseManifestSchema, parseReleaseManifest, type ReleaseAsset, type ReleaseManifest }
  from '../../agent/shared/release-manifest.ts';

export const DEFAULT_RELEASE_URL = 'https://cyberhunter.top/download';
export const PACKAGE_NODE_VERSION = '24.22.1';
export const MINIMUM_NODE = '24.11';
export const MANIFEST_FILE = 'manifest.json';
export const SERVER_PACKAGE = 'plasticine-server';

const VERSION_PATTERN = RELEASE_VERSION_PATTERN;

export const ServerManifestSchema = Type.Object({
  schema: Type.Literal(1),
  name: Type.Literal(SERVER_PACKAGE),
  version: Type.String({ pattern: VERSION_PATTERN }),
  commit: Type.String({ pattern: '^[a-f0-9]{40}$' }),
  builtAt: Type.String({ format: 'date-time' }),
  node: Type.String({ minLength: 1 }),
  releaseUrl: Type.String({ minLength: 1 }),
  excluded: Type.Array(Type.String()),
}, { additionalProperties: false });
export type ServerManifest = Static<typeof ServerManifestSchema>;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

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

export function manifestUrl(releaseUrl: string): URL {
  const base = new URL(releaseUrl.endsWith('/') ? releaseUrl : `${releaseUrl}/`);
  checkReleaseUrl(base);
  return new URL(MANIFEST_FILE, base);
}
