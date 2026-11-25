import { Type } from 'typebox';
import { IdSchema } from './common.ts';
import { MateHandoffRequestSchema } from './mates.ts';

export const MateGroupTaskListArgsSchema = Type.Object({ groupId: IdSchema }, { additionalProperties: false });
export const MateGroupTaskCreateArgsSchema = Type.Object({ ...MateGroupTaskListArgsSchema.properties,
  goal: MateHandoffRequestSchema.properties.goal }, { additionalProperties: false });
export const MateGroupTaskClaimArgsSchema = Type.Object({ taskId: IdSchema }, { additionalProperties: false });
