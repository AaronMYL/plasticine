import { Type, type Static } from 'typebox';
import { AskStreamEventSchema } from './ask-events.ts';
import { DeviceStreamEventSchema } from './device-events.ts';
import { ServerEventSchema } from './events.ts';
import { FeedItemViewSchema } from './feed.ts';
import { ToolGroupStreamEventSchema } from './tool-group-events.ts';
import { MemoryStreamEventSchema } from './memory-events.ts';

export const FeedItemChangedEventSchema = Type.Object({
  type: Type.Literal('feed_item_changed'),
  item: FeedItemViewSchema,
});

export const EveryStreamEventSchema = Type.Union([
  ServerEventSchema,
  AskStreamEventSchema,
  MemoryStreamEventSchema,
  FeedItemChangedEventSchema,
  DeviceStreamEventSchema,
  ToolGroupStreamEventSchema,
]);
export type EveryStreamEvent = Static<typeof EveryStreamEventSchema>;
