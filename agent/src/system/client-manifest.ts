import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Value } from 'typebox/value';
import {
  ClientManifestSchema,
  ClientPublicationSchema,
  type ClientManifest,
  type ClientPublication,
} from '../../shared/api/client-updates.ts';
export function manifestDigest(manifest: ClientManifest): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}
export function readClientManifest(path: string): ClientManifest {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Value.Check(ClientManifestSchema, raw) || raw.protocol.min > raw.protocol.max) {
    throw new Error('客户端清单格式不正确。');
  }
  return raw;
}
export function readClientPublication(path: string): ClientPublication {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Value.Check(ClientPublicationSchema, raw)) {
    throw new Error('客户端发布回执不正确。');
  }
  return raw;
}
/** 只供部署脚本在健康检查成功后调用。读取白名单资源，不接受目录外路径或链接。 */
export function recordClientRelease(
  manifestPath: string,
  receiptPath: string,
  kind: ClientPublication['kind'],
): ClientPublication {
  const manifest = readClientManifest(manifestPath);
  const root = realpathSync(dirname(manifestPath));
  for (const asset of manifest.assets) {
    const path = resolve(root, asset.path);
    const location = relative(root, path);
    if (
      isAbsolute(asset.path) ||
      location.startsWith('..') ||
      isAbsolute(location) ||
      lstatSync(path).isSymbolicLink() ||
      relative(root, realpathSync(path)).startsWith('..')
    ) {
      throw new Error('客户端资源校验失败。');
    }
    const bytes = readFileSync(path);
    if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error('客户端资源校验失败。');
    }
  }
  const previous = existsSync(receiptPath) ? readClientPublication(receiptPath) : null;
  if (previous?.buildId === manifest.buildId && previous.manifestDigest === manifestDigest(manifest)) {
    return previous;
  }
  const receipt: ClientPublication = {
    id: randomUUID(),
    buildId: manifest.buildId,
    manifestDigest: manifestDigest(manifest),
    publishedAt: new Date().toISOString(),
    previousBuildId: previous?.buildId ?? null,
    kind,
  };
  const temporary = `${receiptPath}.${receipt.id}.tmp`;
  writeFileSync(temporary, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, receiptPath);
  return receipt;
}
