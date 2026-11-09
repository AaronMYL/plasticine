// SPDX-License-Identifier: Apache-2.0
// Mac 原生客户端的自更新（第 102 条：Mac 用本机自签证书签名、自己更新）。Mac App 按这个口径实现
// （mac/Sources/Plasticine/self-update-metadata.swift）：
//   GET /v2/nodes/mac/latest（节点 Bearer）→ { version, sha256, url }
//   GET <url>（与服务器同源、同一个节点 Bearer）→ zip 字节；sha256 是这些字节的 SHA-256（小写十六进制）。
// 包由 Mac 构建工作流的发布 job 放到服务器状态目录的 downloads/mac/ 下：一个 zip 和描述它的 latest.json。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema } from './common.ts';

export const MAC_LATEST_PATH = `${API_PREFIX}/nodes/mac/latest`;
export const MAC_DOWNLOADS_PATH = `${API_PREFIX}/nodes/mac/downloads`;

/** Info.plist 的 CFBundleShortVersionString：点分数字。 */
export const MacVersionSchema = Type.String({ pattern: '^[0-9]+(\\.[0-9]+){0,3}$' });
export const Sha256HexSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });
/** 包的文件名只许这几种字符，不带目录（下载路径里的这一段直接对着它）。 */
export const MacPackageFileSchema = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.zip$' });

export const MacLatestResponseSchema = Type.Object({
  version: MacVersionSchema,
  sha256: Sha256HexSchema,
  /** 下载地址：服务器自己的公开地址（同源 HTTPS）+ MAC_DOWNLOADS_PATH/<文件名>。 */
  url: Type.String({ minLength: 1 }),
});
export type MacLatestResponse = Static<typeof MacLatestResponseSchema>;

/** <状态目录>/downloads/mac/latest.json：发布 job 写，服务端只读。 */
export const MacReleaseFileSchema = Type.Object({
  version: MacVersionSchema,
  sha256: Sha256HexSchema,
  file: MacPackageFileSchema,
  /** 这个包是哪个提交构建的、什么时候放上来的（只给人看）。 */
  commit: Type.Optional(Type.String({ maxLength: 64 })),
  publishedAt: Type.Optional(IsoTimeSchema),
});
export type MacReleaseFile = Static<typeof MacReleaseFileSchema>;
