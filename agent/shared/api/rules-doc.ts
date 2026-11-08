// 「怎么替你做事」（《置信度与做事方式改动方案》第 4 批，11-04 用户定）在界面上的两处：
// 1. 回复下面的「记下了：… · 撤销」：用户明说的规矩由后台整理直接写进文档、不出卡，Plasticine 在那条回复下面说一句，
//    带就地撤销（照信息流「不感兴趣 · 撤销」）。撤销 = 那一行退休（改出来的那一行就改回原来的说法），历史都在。
// 2. 一张「全部写入」卡：用户在 Claude 那边立过、还没进 Plasticine 的规矩合成一张，点一次全部写入，单条可以去掉。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
export { hardLines, HARD_LINES_HEADING, HARD_LINES_NOTE } from '../rules-doc.ts';

export const MEMORY_RULES_PATH = `${API_PREFIX}/memory/rules`;
/** POST <this>/:lineId/undo：撤销回复下面「记下了」的那一条。 */
export const MEMORY_RULES_NOTED_PATH = `${MEMORY_RULES_PATH}/noted`;

/** kept：还在文档里；undone：用户撤销了；changed：之后又被改过或合并了（不再给撤销）。 */
export const NOTED_RULE_STATUSES = ['kept', 'undone', 'changed'] as const;
export type NotedRuleStatus = (typeof NOTED_RULE_STATUSES)[number];

/** 这一轮写进「怎么替你做事」的一条规矩。 */
export const NotedRuleSchema = Type.Object({
  lineId: IdSchema,
  text: Type.String({ minLength: 1 }),
  /** 改了已有的那一行时，原来的说法。 */
  previous: OrNull(Type.String()),
  status: Type.Enum(NOTED_RULE_STATUSES),
});
export type NotedRule = Static<typeof NotedRuleSchema>;

export const UndoNotedRuleRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    /** 「记下了」挂在哪条回复下面：回执回这条回复的新样子。 */
    messageId: IdSchema,
  },
  { additionalProperties: false },
);
export type UndoNotedRuleRequest = Static<typeof UndoNotedRuleRequestSchema>;

/** 「全部写入」卡里的一条：规矩、用户当时的原话（在 Claude 那边说的）、什么时候说的。 */
export const RULES_OFFER_MAX_ITEMS = 12;
export const RulesOfferItemSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,31}$' }),
    text: Type.String({ minLength: 1, maxLength: 500 }),
    quote: Type.String({ minLength: 1, maxLength: 1_000 }),
    said: Type.String({ minLength: 1, maxLength: 40 }),
  },
  { additionalProperties: false },
);
export type RulesOfferItem = Static<typeof RulesOfferItemSchema>;

/** 卡上唯一的选项；「先不」是卡底的暂缓（不算作答），不另设选项。 */
export const RULES_OFFER_WRITE = 'write';
/** 去掉的那几条怎么写进作答的那句话：「去掉：「…」「…」」。服务端按卡里每条的原文对，界面照这个写。 */
export const RULES_OFFER_DROP_PREFIX = '去掉：';

export function rulesOfferAnswerText(dropped: readonly RulesOfferItem[]): string | undefined {
  return dropped.length === 0 ? undefined
    : `${RULES_OFFER_DROP_PREFIX}${dropped.map((item) => `「${item.text}」`).join('')}`;
}

/** 作答那句话里去掉了哪几条（按卡里的原文对，不认原文以外的字）。 */
export function droppedOfferItems(items: readonly RulesOfferItem[], text: string | null): Set<string> {
  if (text === null || !text.startsWith(RULES_OFFER_DROP_PREFIX)) {
    return new Set();
  }
  return new Set(items.filter((item) => text.includes(`「${item.text}」`)).map((item) => item.id));
}
