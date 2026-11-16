// SPDX-License-Identifier: Apache-2.0
// 线的定时（11-16 能力总表）：「回来看」（line_wake_later）和「盯着」（watch_start）。他在任务的「在做」里看得到
// 每一条（任务看板多一个 timers），点「关掉」走 POST /v2/timers/stop。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const TIMER_STOP_PATH = `${API_PREFIX}/timers/stop`;

export const TimerViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Union([Type.Literal('wake'), Type.Literal('watch')]),
  /** 哪条线的（点了打开那条线的工作详情）。 */
  lineId: IdSchema,
  lineTitle: Type.String(),
  /** 回来看：到时要看什么；盯着：盯的是什么。 */
  title: Type.String(),
  /** 下次什么时候（回来看就是到点的时间）。 */
  nextAt: IsoTimeSchema,
  /** 盯着的已经看了几次（回来看是 0）。 */
  checks: Type.Integer({ minimum: 0 }),
  /** 上一次没看成的原因。 */
  lastError: OrNull(Type.String()),
}, STRICT);
export type TimerView = Static<typeof TimerViewSchema>;

export const TimerStopRequestSchema = Type.Object({ requestId: RequestIdSchema, id: IdSchema }, STRICT);
export type TimerStopRequest = Static<typeof TimerStopRequestSchema>;
/** 关掉之后剩下的。 */
export const TimerStopResponseSchema = Type.Object({ timers: Type.Array(TimerViewSchema) }, STRICT);
export type TimerStopResponse = Static<typeof TimerStopResponseSchema>;
