import { Type } from 'typebox';
import { NodeActionViewSchema, NodeViewSchema } from './devices.ts';

export const NodeChangedEventSchema = Type.Object({ type: Type.Literal('node_changed'), node: NodeViewSchema });

export const NodeActionRecordedEventSchema = Type.Object({
  type: Type.Literal('node_action_recorded'),
  action: NodeActionViewSchema,
});

export const DeviceStreamEventSchema = Type.Union([NodeChangedEventSchema, NodeActionRecordedEventSchema]);
