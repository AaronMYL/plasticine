// 给模型的空间和订阅工具的参数（《优化清单》第 6、7 条）：写 / 读 / 列空间，建订阅草案、改订阅、现在出一期。

import { Type, type Static } from 'typebox';
import {
  ResearchSettingsSchema,
  SubscriptionScheduleSchema,
  SPACE_EDITIONS,
  SPACE_TITLE_MAX_CHARS,
  SpaceDocSchema,
} from './state.ts';

const STRICT = { additionalProperties: false };
const Title = Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS });

export const SpaceWriteParameters = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, description: 'Existing space to save a new version of' })),
  version: Type.Optional(Type.Integer({ minimum: 1, description: 'The version space_read returned' })),
  title: Title,
  doc: SpaceDocSchema,
  subscriptionId: Type.Optional(Type.String({ minLength: 1,
    description: 'Only when writing a new issue of a subscription' })),
  edition: Type.Optional(Type.Enum(SPACE_EDITIONS, { description: 'Personal review only: daily or weekly' })),
  change: Type.Optional(Type.String({ minLength: 1, maxLength: 200,
    description: 'What this version changed, one short Chinese phrase (shown to him with an undo button)' })),
  rule: Type.Optional(Type.String({ minLength: 1, maxLength: 200,
    description: 'If the change could apply to every future issue, that rule in one phrase (he decides)' })),
}, STRICT);
export type SpaceWriteArgs = Static<typeof SpaceWriteParameters>;

export const SpaceReadParameters = Type.Object({ id: Type.String({ minLength: 1 }) }, STRICT);
export const SpaceListParameters = Type.Object({}, STRICT);

const research = ResearchSettingsSchema.properties;
export const SubscriptionDraftParameters = Type.Object({
  title: Title,
  topics: research.topics,
  focus: Type.Optional(research.focus),
  depth: Type.Optional(research.depth),
  sources: Type.Optional(research.sources),
  preprints: Type.Optional(research.preprints),
  filter: Type.Optional(research.filter),
  schedule: Type.Optional(SubscriptionScheduleSchema),
  sections: Type.Optional(research.sections),
  output: Type.Optional(research.output),
}, STRICT);
export type SubscriptionDraftArgs = Static<typeof SubscriptionDraftParameters>;

export const SubscriptionUpdateParameters = Type.Object({
  id: Type.String({ minLength: 1 }),
  version: Type.Integer({ minimum: 1 }),
  title: Type.Optional(Title),
  settings: Type.Optional(Type.Partial(Type.Object({
    topics: research.topics, focus: research.focus, depth: research.depth, sources: research.sources,
    preprints: research.preprints, filter: research.filter, schedule: SubscriptionScheduleSchema, sections: research.sections,
    output: research.output,
  }, STRICT))),
  status: Type.Optional(Type.Enum(['active', 'paused'], {
    description: 'active only after he has seen a sample issue and said to start; paused when he asks' })),
}, STRICT);
export type SubscriptionUpdateArgs = Static<typeof SubscriptionUpdateParameters>;

export const SubscriptionRunParameters = Type.Object({
  id: Type.String({ minLength: 1 }),
  edition: Type.Optional(Type.Enum(SPACE_EDITIONS, { description: 'Personal review only' })),
}, STRICT);
export type SubscriptionRunArgs = Static<typeof SubscriptionRunParameters>;
