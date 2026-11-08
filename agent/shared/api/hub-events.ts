// /v2/events 上实际会出现的全部事件：旧接口那一组（stream-events.ts 的 EveryStreamEventSchema）加新内核的线事件
// （lines.ts 的 LineStreamEventSchema）。服务端的 event hub 按这一份收发；客户端接线事件时也从这里导类型。

import { Type, type Static } from 'typebox';
import { EveryStreamEventSchema } from './stream-events.ts';
import { LineStreamEventSchema } from './lines.ts';

export const HubStreamEventSchema = Type.Union([EveryStreamEventSchema, LineStreamEventSchema]);
export type HubStreamEvent = Static<typeof HubStreamEventSchema>;
