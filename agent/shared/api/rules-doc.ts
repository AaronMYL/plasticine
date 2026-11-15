// 「怎么替你做事」（《置信度与做事方式改动方案》第 4 批，11-04 用户定）在界面上的两处：
// 1. 回复下面的「记下了：… · 撤销」：用户明说的规矩由后台整理直接写进文档、不出卡，Plasticine 在那条回复下面说一句，
//    带就地撤销（照信息流「不感兴趣 · 撤销」）。撤销 = 那一行退休（改出来的那一行就改回原来的说法），历史都在。
// 2. 一张「全部写入」卡：用户在 Claude 那边立过、还没进 Plasticine 的规矩合成一张，点一次全部写入，单条可以去掉。

import { Type, type Static } from 'typebox';
export { hardLines, HARD_LINES_HEADING, HARD_LINES_NOTE } from '../rules-doc.ts';

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

