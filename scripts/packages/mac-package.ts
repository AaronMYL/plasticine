// 构建端从最终 ZIP 提取身份；发布端验证它仍是那一份字节，且和同批服务包、请求的发布点一致。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { MacVersionSchema, Sha256HexSchema } from '../../agent/shared/api/mac-updates.ts';
import { RELEASE_VERSION_PATTERN } from '../../agent/shared/release-manifest.ts';
import { parseServerManifest, sha256Hex } from './release-manifest.ts';

const MacPackageSchema = Type.Object({ schema: Type.Literal(1),
  version: Type.String({ pattern: RELEASE_VERSION_PATTERN }),
  commit: Type.String({ pattern: '^[a-f0-9]{40}$' }), appVersion: MacVersionSchema,
  releaseUrl: Type.String({ minLength: 1 }), sha256: Sha256HexSchema, size: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type MacPackage = Static<typeof MacPackageSchema>;

function releaseBase(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('Mac 发布点必须是不带凭据的 HTTPS 地址。');
  }
  return url.href.replace(/\/$/, '');
}

export function macPackageName(version: string): string {
  return `Plasticine-mac-${version}.zip`;
}

export function checkMacPackage(input: {
  artifacts: string; version: string; commit: string; baseUrl: string;
}): MacPackage {
  const raw: unknown = JSON.parse(readFileSync(join(input.artifacts, 'mac-package.json'), 'utf8'));
  if (!Value.Check(MacPackageSchema, raw)) throw new Error('Mac 产物身份记录格式不对。');
  const server = parseServerManifest(readFileSync(join(input.artifacts, 'server-manifest.json'), 'utf8'));
  if (raw.version !== input.version || raw.commit !== input.commit
    || server.version !== raw.version || server.commit !== raw.commit) {
    throw new Error('Mac ZIP、服务包与候选提交或版本不一致，没有发布。');
  }
  const base = releaseBase(input.baseUrl);
  if (releaseBase(raw.releaseUrl) !== base || releaseBase(server.releaseUrl) !== base) {
    throw new Error('Mac ZIP 或服务包内的发布点与本次发布地址不一致。');
  }
  const bytes = readFileSync(join(input.artifacts, macPackageName(input.version)));
  if (bytes.length !== raw.size || sha256Hex(bytes) !== raw.sha256) {
    throw new Error('Mac ZIP 与构建时的大小或 SHA-256 校验值不一致。');
  }
  return raw;
}
