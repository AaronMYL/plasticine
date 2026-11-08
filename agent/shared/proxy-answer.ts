// 分身（别人问我的 Plasticine，第 113 条，规格第 8 节）：network/ 收到 ask_ai 后取材料，交给 brain/ 做一次不带工具、
// 不进主会话的模型调用，要回这份 JSON。模型只看到这个联系人能听到的档位里的材料和这段对话最近 20 句。

import { Type, type Static } from 'typebox';

export const PROXY_ANSWER_MAX_CHARS = 2_000;

export const ProxyAnswerSchema = Type.Object({
  answer: Type.String({ maxLength: PROXY_ANSWER_MAX_CHARS }),
  /** 材料里有、说得准。 */
  confident: Type.Boolean(),
  usedMaterialIds: Type.Array(Type.String(), { maxItems: 50 }),
  /** 涉及接单、付钱、对外承诺、材料里没有的事。 */
  needsOwner: Type.Boolean(),
});
export type ProxyAnswer = Static<typeof ProxyAnswerSchema>;

export interface ProxyMaterial {
  /** `<kind>:<id>`，模型在 usedMaterialIds 里引用它。 */
  ref: string;
  kind: 'memory_topic' | 'project' | 'note' | 'space';
  title: string;
  text: string;
}

export interface ProxyLine {
  /** 谁说的：对方、对方的 Plasticine、主人（我）、我的 Plasticine。 */
  speaker: 'them' | 'their_ai' | 'me' | 'my_ai';
  text: string;
}

export interface ProxyQuestion {
  askerName: string;
  askerIsAi: boolean;
  question: string;
  materials: ProxyMaterial[];
  conversation: ProxyLine[];
}

export interface ProxyAnswerer {
  answer(question: ProxyQuestion, signal: AbortSignal): Promise<ProxyAnswer>;
}
