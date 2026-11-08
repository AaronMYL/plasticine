// 发布目录和下载页共用的清单形状；不依赖 Node，可直接在浏览器核验。

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

export const RELEASE_VERSION_PATTERN = '^[0-9]{4}\\.[0-9]{3,4}\\.[0-9]{5,6}$';

export const ReleaseAssetSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  /** 绝对地址，或相对发布清单所在位置的地址。 */
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
  /** 这一版测过的 Node；Linux 上装的 Node 主版本对不上就不自更新，要重跑安装命令。 */
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

