// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ReleaseAssetSchema, RELEASE_VERSION_PATTERN } from './release-manifest.ts';

export const DESKTOP_MANIFEST_FILE = 'desktop.json';

export const DesktopReleaseManifestSchema = Type.Object({
  schema: Type.Literal(1),
  version: Type.String({ pattern: RELEASE_VERSION_PATTERN }),
  commit: Type.String({ pattern: '^[a-f0-9]{40}$' }),
  publishedAt: Type.String({ format: 'date-time' }),
  assets: Type.Object({
    mac: Type.Optional(ReleaseAssetSchema),
    macDisk: Type.Optional(ReleaseAssetSchema),
    windows: Type.Optional(ReleaseAssetSchema),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type DesktopReleaseManifest = Static<typeof DesktopReleaseManifestSchema>;

export function parseDesktopManifest(text: string): DesktopReleaseManifest {
  const raw: unknown = JSON.parse(text);
  if (!Value.Check(DesktopReleaseManifestSchema, raw)) {
    const first = Value.Errors(DesktopReleaseManifestSchema, raw)[0];
    const detail = first === undefined ? '' : `（${first.instancePath || '/'}：${first.message}）`;
    throw new Error(`桌面客户端的发布清单格式不对${detail}。`);
  }
  return raw;
}
