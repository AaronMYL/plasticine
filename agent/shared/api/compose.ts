import { Type, type Static } from 'typebox';
import { API_PREFIX, ApiErrorSchema } from './common.ts';

export const COMPOSE_PATH = `${API_PREFIX}/compose`;
export const COMPOSE_PREDICT_PATH = `${COMPOSE_PATH}/predict`;
export const COMPOSE_OUTCOME_PATH = `${COMPOSE_PATH}/outcome`;
export const COMPOSE_DRAFT_MAX = 2000;
export const COMPOSE_PREDICT_TIMEOUT_MS = 20_000;

export const ComposeTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('line'), id: Type.String({ minLength: 1, maxLength: 64 }) },
    { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('contact'), id: Type.String({ minLength: 1, maxLength: 200 }) },
    { additionalProperties: false }),
]);
export type ComposeTarget = Static<typeof ComposeTargetSchema>;

export const ComposePredictRequestSchema = Type.Object({
  target: ComposeTargetSchema,
  draft: Type.String({ maxLength: COMPOSE_DRAFT_MAX }),
}, { additionalProperties: false });

export const ComposePredictViewSchema = Type.Object({
  text: Type.String(),
  loopId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
}, { additionalProperties: false });
export type ComposePredictView = Static<typeof ComposePredictViewSchema>;

export const ComposePredictStreamEventSchema = Type.Union([
  Type.Object({ type: Type.Literal('text'), delta: Type.String() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('done'), view: ComposePredictViewSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('error'), error: ApiErrorSchema }, { additionalProperties: false }),
]);
export type ComposePredictStreamEvent = Static<typeof ComposePredictStreamEventSchema>;

export const ComposeOutcomeSchema = Type.Object({
  loopId: Type.String({ minLength: 1, maxLength: 64 }),
  outcome: Type.Enum(['kept', 'rejected']),
}, { additionalProperties: false });
export type ComposeOutcome = Static<typeof ComposeOutcomeSchema>;
export const ComposeOutcomeViewSchema = Type.Object({ resolved: Type.Boolean() }, { additionalProperties: false });
