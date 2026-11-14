// /v2/compose：对话和消息输入框里的输入建议（11-13 Aaron 定「预测消息」）。界面只发这是哪段对话、草稿（光标前的字）；
// 服务端按这条线 / 这段聊天现读最近的消息，猜他接下来要发的那一句，草稿空着给整句，有字只给要接在后面的。
// 和笔记续写共用一套：边生成边送的 SSE（text / done / error）、去掉和草稿重叠的字、默认同一个模型（用途 compose_predict
// 不单选就跟「续写」走）。预测闭环：done 里带 loopId，采纳 / 没要报到 /v2/compose/outcome。

import { Type, type Static } from 'typebox';
import { API_PREFIX, ApiErrorSchema } from './common.ts';

export const COMPOSE_PATH = `${API_PREFIX}/compose`;
export const COMPOSE_PREDICT_PATH = `${COMPOSE_PATH}/predict`;
export const COMPOSE_OUTCOME_PATH = `${COMPOSE_PATH}/outcome`;
/** 草稿最多这么长：再长不是一句消息，不猜。 */
export const COMPOSE_DRAFT_MAX = 2000;
/** 一次猜最多等这么久（和笔记续写一样）。 */
export const COMPOSE_PREDICT_TIMEOUT_MS = 20_000;

/** 哪段对话：主线、队友、后台线（line），联系人或群组（contact，群组的 id 也走这里）。 */
export const ComposeTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('line'), id: Type.String({ minLength: 1, maxLength: 64 }) },
    { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('contact'), id: Type.String({ minLength: 1, maxLength: 200 }) },
    { additionalProperties: false }),
]);
export type ComposeTarget = Static<typeof ComposeTargetSchema>;

export const ComposePredictRequestSchema = Type.Object({
  target: ComposeTargetSchema,
  /** 光标前的字（光标不在末尾时界面不来问）。空的就是要一整句。 */
  draft: Type.String({ maxLength: COMPOSE_DRAFT_MAX }),
}, { additionalProperties: false });
export type ComposePredictRequest = Static<typeof ComposePredictRequestSchema>;

export const ComposePredictViewSchema = Type.Object({
  /** 要接在草稿后面的字；空串 = 这次不给（没轮到他说、猜不出来）。 */
  text: Type.String(),
  /** 预测闭环：这一条记成了一次预测，采纳或没要按这个 id 报回来。 */
  loopId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
}, { additionalProperties: false });
export type ComposePredictView = Static<typeof ComposePredictViewSchema>;

export const ComposePredictStreamEventSchema = Type.Union([
  Type.Object({ type: Type.Literal('text'), delta: Type.String() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('done'), view: ComposePredictViewSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('error'), error: ApiErrorSchema }, { additionalProperties: false }),
]);
export type ComposePredictStreamEvent = Static<typeof ComposePredictStreamEventSchema>;

/** kept：Tab 或点了浅色字；rejected：摆了一会儿被打字盖掉，或按了 Esc。 */
export const ComposeOutcomeSchema = Type.Object({
  loopId: Type.String({ minLength: 1, maxLength: 64 }),
  outcome: Type.Enum(['kept', 'rejected']),
}, { additionalProperties: false });
export type ComposeOutcome = Static<typeof ComposeOutcomeSchema>;
export const ComposeOutcomeViewSchema = Type.Object({ resolved: Type.Boolean() }, { additionalProperties: false });
