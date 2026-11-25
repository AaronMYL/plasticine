// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const PUSHES_PATH = `${API_PREFIX}/pushes`;
export const PUSH_WITHDRAW_PATH = `${PUSHES_PATH}/withdraw`;
export const PUSHES_RECENT = 30;
export const pushTag = (id: string): string => `push:${id}`;

export const PushRecordSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  from: Type.String(),
  lineId: IdSchema,
  url: Type.String({ pattern: '^/' }),
  createdAt: IsoTimeSchema,
  withdrawnAt: OrNull(IsoTimeSchema),
}, STRICT);
export type PushRecord = Static<typeof PushRecordSchema>;

/** GET /v2/pushes */
export const PushesResponseSchema = Type.Object({ pushes: Type.Array(PushRecordSchema) }, STRICT);
export type PushesResponse = Static<typeof PushesResponseSchema>;

/** POST /v2/pushes/withdraw */
export const PushWithdrawRequestSchema = Type.Object({ requestId: RequestIdSchema, id: IdSchema }, STRICT);
export type PushWithdrawRequest = Static<typeof PushWithdrawRequestSchema>;
export const PushWithdrawResponseSchema = Type.Object({ push: PushRecordSchema }, STRICT);
export type PushWithdrawResponse = Static<typeof PushWithdrawResponseSchema>;
