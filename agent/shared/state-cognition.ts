// M3: what the brain notices about its own understanding, and old rows that have no new object of their own.
// - 分歧标记（≠）：脑发现自己的理解和某条判断 / 约定 / 记忆不一致时记下两边——用户的立场与依据、它的立场与依据、
//   什么会改变各自的看法（《从零方案》第 4、5 节「分歧」）。标记只记两边，不改被标的对象，更不碰用户确认字段。
// - 旧行存档：迁移里没有对应新对象的旧行（旧版的卡、抽取批次、维护索引）整行原样存一份，迁移校验逐条对照。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

/** An old row archived whole. `targetTable` / `targetId`: the new object it belongs to, when there is one. */
export const LegacyRowInputSchema = Type.Object(
  {
    sourceDb: Text,
    sourceTable: Text,
    legacyId: Text,
    targetTable: Nullable(Text),
    targetId: Nullable(IdSchema),
    payload: Type.Unknown(),
    reason: Text,
  },
  STRICT,
);
export type LegacyRowInput = Static<typeof LegacyRowInputSchema>;
export const LegacyRowSchema = Type.Object({ ...LegacyRowInputSchema.properties, createdAt: IsoTimeSchema });
export type LegacyRow = Static<typeof LegacyRowSchema>;
