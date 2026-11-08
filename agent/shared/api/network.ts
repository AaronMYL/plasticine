// /v2/network: 这台 Plasticine 在 Cyber Hunter 网络上的账号（第 113 条）。2026-11-08 起自助注册：起 @账号就是在网络里
// 注册，不要邀请码（旧实例带着码来也照收，用了谁的码就先给谁发好友请求）；加入后照旧可以给朋友生成邀请码。中继本身的接口在 /v2/net/*，不走设备会话，见 docs/specs/contacts-network.md。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const NETWORK_PATH = `${API_PREFIX}/network`;
export const NETWORK_JOIN_PATH = `${NETWORK_PATH}/join`;
export const NETWORK_INVITES_PATH = `${NETWORK_PATH}/invites`;
export const NETWORK_AVATAR_PATH = `${NETWORK_PATH}/avatar`;
export const NETWORK_HANDLE_PATTERN = '^[a-z0-9_]{3,24}$';

export const NetworkStatusSchema = Type.Object({
  joined: Type.Boolean(),
  relayUrl: Type.String(),
  account: OrNull(Type.Object({
    id: Type.String(),
    handle: Type.String(),
    displayName: Type.String(),
    joinedAt: IsoTimeSchema,
    avatar: Type.Optional(OrNull(Type.String())),
    /** 朋友加我、手机打开都用它：<handle>.cyberhunter.top（中继的主域名换了就跟着换）。 */
    host: Type.Optional(Type.String()),
  })),
  /** 这台实例经隧道对外的那个名字：证书拿到了没有（第一次打开的第三步等它）。没装隧道是 null。 */
  tunnel: Type.Optional(OrNull(Type.Object({
    state: Type.Union([Type.Literal('off'), Type.Literal('connecting'), Type.Literal('ready'),
      Type.Literal('error')]),
    detail: OrNull(Type.String()),
  }))),
  lastSyncAt: OrNull(IsoTimeSchema),
  /** 最近一次和中继同步出的错，一句人话；好了就是 null。 */
  lastError: OrNull(Type.String()),
  /**
   * 第一次打开（2026-11-05 Friend-Onboard）：新装的实例（还没加入网络、主对话一句都没说过）连上模型后接着走加入网络、
   * 在手机上打开两步。中继在本机的那台（Alex 的）不走。
   */
  welcome: Type.Optional(Type.Boolean()),
  /** 加入要不要邀请码：2026-11-08 起自助注册，一律 false（字段留着给旧客户端）。 */
  inviteNeeded: Type.Boolean(),
});
export type NetworkStatus = Static<typeof NetworkStatusSchema>;

export const JoinNetworkRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  handle: Type.String({ pattern: NETWORK_HANDLE_PATTERN }),
  displayName: Type.String({ minLength: 1, maxLength: 40 }),
  inviteCode: Type.Optional(Type.String({ maxLength: 64 })),
  relayUrl: Type.Optional(Type.String({ maxLength: 200 })),
});

export const NetworkInviteSchema = Type.Object({
  code: Type.String(),
  createdAt: IsoTimeSchema,
  expiresAt: IsoTimeSchema,
  usedBy: OrNull(Type.String()),
});
export type NetworkInvite = Static<typeof NetworkInviteSchema>;

export const CreateInviteRequestSchema = Type.Object({ requestId: RequestIdSchema });
export const SetAvatarRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  /** 裁好的圆形小图（data URL，64k 字符以内）；null = 去掉。 */
  avatar: OrNull(Type.String({ maxLength: 64_000 })),
});
export const NetworkInviteResponseSchema = Type.Object({
  invite: NetworkInviteSchema,
  /** 一句可以直接发给朋友的话：中继地址、邀请码、在他的 Plasticine「设置 · 账号与网络」里填。 */
  shareText: Type.String(),
});
export const NetworkInvitesResponseSchema = Type.Object({ invites: Type.Array(NetworkInviteSchema) });
