// SPDX-License-Identifier: Apache-2.0
// 通用连接（11-16 能力总表）：他在设置 · AI · 连接里连一个服务（给了 MCP 连接地址的：Notion、GitHub、飞书……），
// Plasticine 按它给的工具用：标了只读的直接用，会改东西的按承诺和授权。令牌只进不出：填了存在服务器上，界面只看到
// 「填过了」。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const CONNECTIONS_PATH = `${API_PREFIX}/connections`;
export const connectionPath = (id: string): string => `${CONNECTIONS_PATH}/${encodeURIComponent(id)}`;
export const connectionTestPath = (id: string): string => `${connectionPath(id)}/test`;
export const connectionDeletePath = (id: string): string => `${connectionPath(id)}/delete`;
export const CONNECTION_NAME_MAX = 40;

export const ConnectionToolSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  description: Type.String({ maxLength: 1_000 }),
  /** 对面标了只读：直接用；false 是会改东西的，按承诺和授权。 */
  readOnly: Type.Boolean(),
}, STRICT);
export type ConnectionTool = Static<typeof ConnectionToolSchema>;

export const ConnectionViewSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  url: Type.String(),
  /** 填过令牌没有（令牌本身不回给界面）。 */
  hasToken: Type.Boolean(),
  enabled: Type.Boolean(),
  tools: Type.Array(ConnectionToolSchema),
  status: Type.Union([Type.Literal('untested'), Type.Literal('ok'), Type.Literal('error')]),
  /** 没连上的原因。 */
  error: OrNull(Type.String()),
  checkedAt: OrNull(IsoTimeSchema),
}, STRICT);
export type ConnectionView = Static<typeof ConnectionViewSchema>;

export const ConnectionsResponseSchema = Type.Object({ connections: Type.Array(ConnectionViewSchema) }, STRICT);
export type ConnectionsResponse = Static<typeof ConnectionsResponseSchema>;

const Name = Type.String({ minLength: 1, maxLength: CONNECTION_NAME_MAX });
const Url = Type.String({ minLength: 8, maxLength: 2_000, pattern: '^https://' });
// 令牌放进请求头，只能是可见的 ASCII 字符。
const Token = Type.String({ minLength: 1, maxLength: 4_000, pattern: '^[\\x21-\\x7e]+$' });

/** POST /v2/connections：加一个（加完马上测一次，回测的结果）。 */
export const ConnectionCreateRequestSchema = Type.Object({ requestId: RequestIdSchema, name: Name, url: Url,
  token: Type.Optional(Token) }, STRICT);
export type ConnectionCreateRequest = Static<typeof ConnectionCreateRequestSchema>;

/** POST /v2/connections/:id：改名字、地址、令牌（null 是清掉）、开关。 */
export const ConnectionUpdateRequestSchema = Type.Object({ requestId: RequestIdSchema, name: Type.Optional(Name),
  url: Type.Optional(Url), token: Type.Optional(OrNull(Token)), enabled: Type.Optional(Type.Boolean()) }, STRICT);
export type ConnectionUpdateRequest = Static<typeof ConnectionUpdateRequestSchema>;

/** POST /v2/connections/:id/test、/delete 只带请求号。 */
export const ConnectionActionRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type ConnectionActionRequest = Static<typeof ConnectionActionRequestSchema>;

export const ConnectionResponseSchema = Type.Object({ connection: ConnectionViewSchema }, STRICT);
export type ConnectionResponse = Static<typeof ConnectionResponseSchema>;
