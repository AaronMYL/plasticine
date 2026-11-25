import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema } from '../../shared/api/common.ts';
import { LINE_ATTACHMENTS_MAX, LINE_MESSAGE_MAX_CHARS } from '../../shared/api/lines.ts';

export const MateGroupTaskMetaSchema = Type.Object({
  groupId: IdSchema,
  offerKey: Type.String({ minLength: 1, maxLength: 200 }),
  offeredByLineId: IdSchema,
  offeredAt: IsoTimeSchema,
  goal: Type.String({ minLength: 1, maxLength: LINE_MESSAGE_MAX_CHARS }),
  attachments: Type.Array(IdSchema, { maxItems: LINE_ATTACHMENTS_MAX }),
}, { additionalProperties: false });
export type MateGroupTaskMeta = Static<typeof MateGroupTaskMetaSchema>;
