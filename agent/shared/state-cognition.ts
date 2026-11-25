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
