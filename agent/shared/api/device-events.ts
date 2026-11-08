// 执行节点在 /v2/events 上的事件：节点变了（配对、撤销、上限改了、报到）、记下了一个设备动作（做了、被拒、没做成——
// 被拒的那一句原因用户在这里看到）。都带整个视图，客户端按 version 换那一行。

import { Type, type Static } from 'typebox';
import { NodeActionViewSchema, NodeViewSchema } from './devices.ts';

export const NodeChangedEventSchema = Type.Object({ type: Type.Literal('node_changed'), node: NodeViewSchema });

export const NodeActionRecordedEventSchema = Type.Object({
  type: Type.Literal('node_action_recorded'),
  action: NodeActionViewSchema,
});

export const DeviceStreamEventSchema = Type.Union([NodeChangedEventSchema, NodeActionRecordedEventSchema]);
export type DeviceStreamEvent = Static<typeof DeviceStreamEventSchema>;
