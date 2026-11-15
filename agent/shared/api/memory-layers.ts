// /v2/memory/layers-move（记忆分层，11-15 Aaron 看过设计稿「搬家记录」）：现有记忆按层分好搬过去以后的一页记录——
// 搬了哪些（现在还在那边的）、原来在哪、没动的有几行；每条能搬回去，也能全部搬回去。
// - GET  /v2/memory/layers-move        最近一次搬家；没搬过 move 为 null
// - POST /v2/memory/layers-move/undo   搬回去（给 lineIds 只搬那几行，不给是全部）

import { Type, type Static } from 'typebox';
import { MEMORY_LINE_SECTIONS } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };
export const MEMORY_LAYERS_MOVE_PATH = `${API_PREFIX}/memory/layers-move`;
export const MEMORY_LAYERS_MOVE_UNDO_PATH = `${MEMORY_LAYERS_MOVE_PATH}/undo`;

export const LayersMoveItemSchema = Type.Object({
  lineId: IdSchema,
  text: Type.String(),
  toDocId: IdSchema,
  toTitle: Type.String(),
  section: Type.Enum(MEMORY_LINE_SECTIONS),
  /** 原来在哪一篇的名字；从旧的「约定」来的是 null。 */
  fromTitle: OrNull(Type.String()),
}, STRICT);
export type LayersMoveItemView = Static<typeof LayersMoveItemSchema>;

export const LayersMoveViewSchema = Type.Object({
  at: IsoTimeSchema,
  items: Type.Array(LayersMoveItemSchema),
  /** 没动的行数。 */
  kept: Type.Integer({ minimum: 0 }),
}, STRICT);
export type LayersMoveView = Static<typeof LayersMoveViewSchema>;

export const LayersMoveResponseSchema = Type.Object({ move: OrNull(LayersMoveViewSchema) }, STRICT);
export type LayersMoveResponse = Static<typeof LayersMoveResponseSchema>;

export const UndoLayersMoveRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  lineIds: Type.Optional(Type.Array(IdSchema, { minItems: 1, maxItems: 300 })),
}, STRICT);
export type UndoLayersMoveRequest = Static<typeof UndoLayersMoveRequestSchema>;
