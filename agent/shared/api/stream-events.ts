// /v2/events 上旧接口那一组事件的全集（新内核的线事件另在 lines.ts，两组合起来是 hub-events.ts）。客户端按它列全集、
// 一一处理；服务端的 event hub 按 hub-events.ts 收发。2026-11-05 删掉的功能（任务、关切、十件事、判断、≠、自迭代、事、
// 专注、提醒、成果、旧对话轮）的事件都不在了。

import { Type, type Static } from 'typebox';
import { AskStreamEventSchema } from './ask-events.ts';
import { DeviceStreamEventSchema } from './device-events.ts';
import { ServerEventSchema } from './events.ts';
import { FeedItemViewSchema } from './feed.ts';
import { M5bStreamEventSchema } from './m5b-events.ts';
import { MemoryStreamEventSchema } from './memory-events.ts';

/** 信息流里一条到了、点了赞或不感兴趣、收藏了：带整条。 */
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
  M5bStreamEventSchema,
]);
export type EveryStreamEvent = Static<typeof EveryStreamEventSchema>;
export type EveryStreamEventType = EveryStreamEvent['type'];
