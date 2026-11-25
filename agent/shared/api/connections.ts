// SPDX-License-Identifier: Apache-2.0

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
  readOnly: Type.Boolean(),
}, STRICT);
export type ConnectionTool = Static<typeof ConnectionToolSchema>;

export const ConnectionViewSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  url: Type.String(),
  hasToken: Type.Boolean(),
  enabled: Type.Boolean(),
  tools: Type.Array(ConnectionToolSchema),
  status: Type.Union([Type.Literal('untested'), Type.Literal('ok'), Type.Literal('error')]),
  error: OrNull(Type.String()),
  checkedAt: OrNull(IsoTimeSchema),
}, STRICT);
export type ConnectionView = Static<typeof ConnectionViewSchema>;

export const ConnectionsResponseSchema = Type.Object({ connections: Type.Array(ConnectionViewSchema) }, STRICT);
export type ConnectionsResponse = Static<typeof ConnectionsResponseSchema>;

const Name = Type.String({ minLength: 1, maxLength: CONNECTION_NAME_MAX });
const Url = Type.String({ minLength: 8, maxLength: 2_000, pattern: '^https://' });
const Token = Type.String({ minLength: 1, maxLength: 4_000, pattern: '^[\\x21-\\x7e]+$' });

export const ConnectionCreateRequestSchema = Type.Object({ requestId: RequestIdSchema, name: Name, url: Url,
  token: Type.Optional(Token) }, STRICT);
export type ConnectionCreateRequest = Static<typeof ConnectionCreateRequestSchema>;

export const ConnectionUpdateRequestSchema = Type.Object({ requestId: RequestIdSchema, name: Type.Optional(Name),
  url: Type.Optional(Url), token: Type.Optional(OrNull(Token)), enabled: Type.Optional(Type.Boolean()) }, STRICT);
export type ConnectionUpdateRequest = Static<typeof ConnectionUpdateRequestSchema>;

export const ConnectionActionRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type ConnectionActionRequest = Static<typeof ConnectionActionRequestSchema>;

export const ConnectionResponseSchema = Type.Object({ connection: ConnectionViewSchema }, STRICT);
export type ConnectionResponse = Static<typeof ConnectionResponseSchema>;
