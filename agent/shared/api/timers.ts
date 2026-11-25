// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const TIMER_STOP_PATH = `${API_PREFIX}/timers/stop`;

export const TimerViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Union([Type.Literal('wake'), Type.Literal('watch')]),
  lineId: IdSchema,
  lineTitle: Type.String(),
  title: Type.String(),
  nextAt: IsoTimeSchema,
  checks: Type.Integer({ minimum: 0 }),
  lastError: OrNull(Type.String()),
}, STRICT);
export type TimerView = Static<typeof TimerViewSchema>;

export const TimerStopRequestSchema = Type.Object({ requestId: RequestIdSchema, id: IdSchema }, STRICT);
export type TimerStopRequest = Static<typeof TimerStopRequestSchema>;
export const TimerStopResponseSchema = Type.Object({ timers: Type.Array(TimerViewSchema) }, STRICT);
export type TimerStopResponse = Static<typeof TimerStopResponseSchema>;
