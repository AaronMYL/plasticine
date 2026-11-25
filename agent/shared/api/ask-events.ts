import { Type } from 'typebox';
import { AskViewSchema } from './asks.ts';

const BOARD_STATE = {
  currentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  waitingOnYouCount: Type.Optional(Type.Integer({ minimum: 0 })),
};

export const AskCreatedEventSchema = Type.Object({
  type: Type.Literal('ask_created'),
  ...BOARD_STATE,
  ask: AskViewSchema,
  current: Type.Boolean(),
});

/** A card was answered on some device: everywhere it folds into one line. */
export const AskAnsweredEventSchema = Type.Object({
  type: Type.Literal('ask_answered'),
  ...BOARD_STATE,
  ask: AskViewSchema,
});

export const AskUpdatedEventSchema = Type.Object({
  type: Type.Literal('ask_updated'),
  ...BOARD_STATE,
  ask: AskViewSchema,
});

export const AskStreamEventSchema = Type.Union([AskCreatedEventSchema, AskAnsweredEventSchema, AskUpdatedEventSchema]);
