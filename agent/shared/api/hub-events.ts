import { Type, type Static } from 'typebox';
import { EveryStreamEventSchema } from './stream-events.ts';
import { LineStreamEventSchema } from './lines.ts';

export const HubStreamEventSchema = Type.Union([EveryStreamEventSchema, LineStreamEventSchema]);
export type HubStreamEvent = Static<typeof HubStreamEventSchema>;
