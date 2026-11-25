import { Type, type Static } from 'typebox';
import { IdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const ScheduleCardPreviewSchema = Type.Object({
  scheduleId: IdSchema,
  title: Type.String(),
  when: Type.String(),
  who: OrNull(Type.Array(Type.String())),
  what: Type.String(),
  place: OrNull(Type.String()),
  report: Type.String(),
  projectName: Type.String(),
  outward: Type.Boolean(),
  replaces: Type.Boolean(),
}, STRICT);
export type ScheduleCardPreview = Static<typeof ScheduleCardPreviewSchema>;

export const SubscriptionCardPreviewSchema = Type.Object({
  subscriptionId: IdSchema,
  title: Type.String(),
  when: Type.String(),
  spaceId: IdSchema,
  issueNumber: OrNull(Type.Integer({ minimum: 1 })),
}, STRICT);
export type SubscriptionCardPreview = Static<typeof SubscriptionCardPreviewSchema>;
