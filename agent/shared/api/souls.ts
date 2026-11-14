// 主线和每位队友各一份 Soul（第13批，11-14 Aaron 定：Soul 只放「我是谁」，各自维护、随相处慢慢长成；「你随时改，它们
// 每晚自己改，能看能撤」）。和记忆页的「规则」（soul.ts，11-11 起叫规则）不是一回事：
//   GET  /v2/souls/:owner                    → { soul, revisions }：这一份和最近的改动（谁改的、改了几处、撤没撤）；
//   POST /v2/souls/:owner                    { requestId, version, text }：他改；
//   POST /v2/souls/:owner/undo               { requestId, revisionId }：撤回一次改动（之后又改过就不让撤）；
//   GET  /v2/souls/:owner/revisions/:id      → { revision, diff }：看改动（一行行标出加的、删的）。
// owner 是 main（主线）或队友的 id。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { SOUL_TEXT_MAX_CHARS } from '../soul-text.ts';

export const SOULS_PATH = `${API_PREFIX}/souls`;
export const SOUL_OWNER_MAIN = 'main';
/** user：他在编辑弹框里改的；self：夜里自己改的；system：起步时写的；move：规则搬家搬进来的。 */
export const SOUL_ACTORS = ['user', 'self', 'system', 'move'] as const;
export type SoulActor = (typeof SOUL_ACTORS)[number];
/** 列出最近几次改动。 */
export const SOUL_REVISIONS_SHOWN = 20;

export const SoulOwnerSchema = Type.Union([Type.Literal(SOUL_OWNER_MAIN), IdSchema]);

export const SoulDocSchema = Type.Object({
  owner: SoulOwnerSchema,
  text: Type.String({ maxLength: SOUL_TEXT_MAX_CHARS }),
  version: Type.Integer({ minimum: 1 }),
  updatedAt: IsoTimeSchema,
}, { additionalProperties: false });
export type SoulDoc = Static<typeof SoulDocSchema>;

export const SoulRevisionSchema = Type.Object({
  id: IdSchema,
  actor: Type.Enum(SOUL_ACTORS),
  /** 一句说明：夜里自己改的写改了什么，搬家写搬进来几条。 */
  note: Type.String({ maxLength: 300 }),
  at: IsoTimeSchema,
  /** 改了几处（连着改的几行算一处）。 */
  changes: Type.Integer({ minimum: 0 }),
  undoneAt: Type.Union([IsoTimeSchema, Type.Null()]),
  /** 这一次是撤回哪一次的。 */
  undoes: Type.Union([IdSchema, Type.Null()]),
}, { additionalProperties: false });
export type SoulRevision = Static<typeof SoulRevisionSchema>;

export const SoulResponseSchema = Type.Object({
  soul: SoulDocSchema,
  revisions: Type.Array(SoulRevisionSchema, { maxItems: SOUL_REVISIONS_SHOWN }),
}, { additionalProperties: false });
export type SoulResponse = Static<typeof SoulResponseSchema>;

export const UpdateSoulRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  text: Type.String({ minLength: 1, maxLength: SOUL_TEXT_MAX_CHARS }),
}, { additionalProperties: false });
export type UpdateSoulRequest = Static<typeof UpdateSoulRequestSchema>;

export const UndoSoulRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  revisionId: IdSchema,
}, { additionalProperties: false });
export type UndoSoulRequest = Static<typeof UndoSoulRequestSchema>;

export const SoulDiffLineSchema = Type.Object({
  kind: Type.Enum(['same', 'add', 'remove']),
  text: Type.String(),
}, { additionalProperties: false });

export const SoulRevisionDiffResponseSchema = Type.Object({
  revision: SoulRevisionSchema,
  diff: Type.Array(SoulDiffLineSchema),
}, { additionalProperties: false });
export type SoulRevisionDiffResponse = Static<typeof SoulRevisionDiffResponseSchema>;
