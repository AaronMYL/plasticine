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
    host: Type.Optional(Type.String()),
  })),
  tunnel: Type.Optional(OrNull(Type.Object({
    state: Type.Union([Type.Literal('off'), Type.Literal('connecting'), Type.Literal('ready'),
      Type.Literal('error')]),
    detail: OrNull(Type.String()),
  }))),
  lastSyncAt: OrNull(IsoTimeSchema),
  lastError: OrNull(Type.String()),
  welcome: Type.Optional(Type.Boolean()),
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
  avatar: OrNull(Type.String({ maxLength: 64_000 })),
});
export const NetworkInviteResponseSchema = Type.Object({
  invite: NetworkInviteSchema,
  shareText: Type.String(),
});
export const NetworkInvitesResponseSchema = Type.Object({ invites: Type.Array(NetworkInviteSchema) });
