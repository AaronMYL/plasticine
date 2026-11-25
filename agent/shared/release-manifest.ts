// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

export const RELEASE_VERSION_PATTERN = '^[0-9]{4}\\.[0-9]{3,4}\\.[0-9]{5,6}$';

export const ReleaseAssetSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  url: Type.String({ minLength: 1 }),
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  size: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type ReleaseAsset = Static<typeof ReleaseAssetSchema>;

export const ReleaseManifestSchema = Type.Object({
  schema: Type.Literal(1),
  version: Type.String({ pattern: RELEASE_VERSION_PATTERN }),
  commit: Type.String({ pattern: '^[a-f0-9]{40}$' }),
  publishedAt: Type.String({ format: 'date-time' }),
  nodeVersion: Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' }),
  assets: Type.Object({
    server: ReleaseAssetSchema,
    linuxInstaller: ReleaseAssetSchema,
    mac: Type.Optional(ReleaseAssetSchema),
    windows: Type.Optional(ReleaseAssetSchema),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type ReleaseManifest = Static<typeof ReleaseManifestSchema>;

export function parseReleaseManifest(text: string): ReleaseManifest {
  const raw: unknown = JSON.parse(text);
  if (!Value.Check(ReleaseManifestSchema, raw)) {
    const first = Value.Errors(ReleaseManifestSchema, raw)[0];
    const detail = first === undefined ? '' : `（${first.instancePath || '/'}：${first.message}）`;
    throw new Error(`发布清单 格式不对${detail}。`);
  }
  return raw;
}

