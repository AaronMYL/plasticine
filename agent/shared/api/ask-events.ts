// 要你定的卡在 /v2/events 上的三种事件（原来和任务的事件放在 task-events.ts，2026-11-05 任务删了，卡留着）：
// 新出一张、在哪台设备上答了、放回去（先不）或撤回。都带整张卡和「等你」的条数。

import { Type, type Static } from 'typebox';
import { AskViewSchema } from './asks.ts';

const BOARD_STATE = {
  currentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  waitingOnYouCount: Type.Optional(Type.Integer({ minimum: 0 })),
};

/** A new card. `current` says whether it is the one to spread open now (otherwise it waits in 等你). */
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

/** A card was put back (先不) or withdrawn. */
export const AskUpdatedEventSchema = Type.Object({
  type: Type.Literal('ask_updated'),
  ...BOARD_STATE,
  ask: AskViewSchema,
});

export const AskStreamEventSchema = Type.Union([AskCreatedEventSchema, AskAnsweredEventSchema, AskUpdatedEventSchema]);
export type AskStreamEvent = Static<typeof AskStreamEventSchema>;
