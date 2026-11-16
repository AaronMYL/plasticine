// SPDX-License-Identifier: Apache-2.0
// 推到他手机上的记录（11-16 能力总表「推到手机」）：主线、队友、后台的事都能推（push_notify），每一条在记忆 · 主动告诉你
// 的「最近」里看得到：推了什么、谁推的、什么时候；能撤回（记下撤回，开着的网页、桌面版把那条系统通知收掉）。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const PUSHES_PATH = `${API_PREFIX}/pushes`;
export const PUSH_WITHDRAW_PATH = `${PUSHES_PATH}/withdraw`;
/** 「最近」列多少条。 */
export const PUSHES_RECENT = 30;
/** 推出去的那一条系统通知的 tag：撤回时按它收掉。 */
export const pushTag = (id: string): string => `push:${id}`;

export const PushRecordSchema = Type.Object({
  id: IdSchema,
  /** 推的那一句（系统通知的正文）。 */
  title: Type.String(),
  /** 谁推的：主线、队友的名字、后台那件事的标题。 */
  from: Type.String(),
  lineId: IdSchema,
  /** 打开那段对话：站内路径。 */
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
