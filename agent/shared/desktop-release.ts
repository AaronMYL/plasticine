// 桌面客户端（Electron 壳，《优化清单》第 14 条）的发布清单：发布点根上的 desktop.json。
// 不放进 manifest.json：已经装着的 Linux 更新器、旧 Mac App、Windows 托盘按严格 schema 读 manifest.json，多一个键
// 它们就读不懂、停在旧版。桌面客户端只读这一份；旧的 Swift Mac App 不读它，所以不会被自动换成 Electron 版
// （第 18 条：他手动装一次）。

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
    /** Mac 自更新用的 zip（里面是 Plasticine.app，CI 临时签名，装时在他的 Mac 上用本机证书重签）。 */
    mac: Type.Optional(ReleaseAssetSchema),
    /** Mac 第一次手动安装用的 dmg（下载页给人点的）。 */
    macDisk: Type.Optional(ReleaseAssetSchema),
    /** Windows 的 NSIS 安装程序（不签名；自更新时静默装）。 */
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
