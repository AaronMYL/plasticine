// 预测闭环第三步（11-13 Aaron 定）：权限是挣出来的。ask_user 出的「推出来的」卡，推荐项就是 Plasticine 的预测；
// 他原样选了推荐项算收下，选了别的或多写了几句算改了。某一类事连续原样收下 OFFER_STREAK（5）次，出一张放手卡
// 「这类以后我直接做？」（硬线：权限变化每次都问）。他点了「以后直接做」才放：这一类之后推出来的卡不再出，按推荐项
// 直接做，做完告诉他；他说一句「这类还是先问我」就收回（loop_take_back）。收回或答了「还是先问我」以后重新数。
// 有几种可能、资料里没有、硬线的卡不管放没放手都照常问。

import type { Ask } from '../../shared/state.ts';
import type { AskDesk, AskResolver, Changes } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import { normalizeTopic, OFFER_STREAK, streak, type LoopOutcome } from './tally.ts';

export const OFFER_PURPOSE = 'loop_offer';
export type AutonomyState = Pick<StateService, 'loop'>;

interface OptionLike { id: string; label: string; recommended?: boolean | undefined }

/** 这一类他放过手、这张又是推出来的卡：不出卡，回推荐的那一项。别的情况回 null，照常出卡。 */
export function autoChoice(state: AutonomyState, topic: string | undefined, basis: string,
  options: readonly OptionLike[]): OptionLike | null {
  const name = topic === undefined ? null : normalizeTopic(topic);
  if (name === null || basis !== 'inferred' || state.loop.grants.active(name) === undefined) {
    return null;
  }
  return options.find((option) => option.recommended === true) ?? null;
}

/** 出了推出来的卡：推荐项记成这一次的预测（同一张卡只记一次）。 */
export function recordAsk(state: AutonomyState, ask: Ask, topic: string | undefined): void {
  const name = topic === undefined ? null : normalizeTopic(topic);
  const recommended = ask.options.find((option) => option.recommended);
  if (name === null || ask.basis !== 'inferred' || recommended === undefined) {
    return;
  }
  state.loop.record({ area: 'ask', topic: name, ref: ask.id, expected: recommended.label });
}

function outcomeOf(ask: Ask): LoopOutcome | null {
  const answer = ask.answer;
  if (answer === null) {
    return null;
  }
  const recommended = ask.options.find((option) => option.recommended);
  const extra = answer.text !== null && answer.text.trim() !== '';
  return answer.optionId !== null && answer.optionId === recommended?.id && !extra ? 'kept' : 'changed';
}

/** 卡答了：记结果；这一类连续原样收下够了、还没放手、也没有开着的放手卡，回这一类的叫法（该出放手卡了）。 */
export function settleAsk(state: AutonomyState, ask: Ask, topic: string | undefined): string | null {
  const name = topic === undefined ? null : normalizeTopic(topic);
  const outcome = outcomeOf(ask);
  if (name === null || outcome === null || ask.basis !== 'inferred') {
    return null;
  }
  state.loop.resolveByRef('ask', ask.id, outcome, ask.answer?.label ?? null);
  if (outcome !== 'kept' || state.loop.grants.active(name) !== undefined || state.loop.offers.open(name)) {
    return null;
  }
  const since = [state.loop.grants.lastRevokedAt(name), state.loop.offers.lastDeclinedAt(name)]
    .filter((at): at is string => at !== null).sort().at(-1) ?? null;
  return streak(state.loop.outcomes('ask', name, OFFER_STREAK, since)) >= OFFER_STREAK ? name : null;
}

/** 放手卡：同一类、同一段（上次收回或拒绝以后）只出一张。 */
export function raiseOffer(state: AutonomyState, desk: AskDesk, changes: Changes, topic: string): Ask {
  const since = state.loop.offers.lastDeclinedAt(topic) ?? state.loop.grants.lastRevokedAt(topic) ?? 'start';
  return desk.raise(changes, {
    kind: 'confirm',
    purpose: OFFER_PURPOSE,
    question: `「${topic}」这类事，以后我直接做？`,
    detail: `你最近连续 ${OFFER_STREAK} 次都原样同意了我推荐的做法。答应以后，这类事我按推荐直接做，做完告诉你；`
      + '你随时说一句「这类还是先问我」就收回。花钱、对外发出、删除这些照样每次问你。',
    options: [{ id: 'yes', label: '以后直接做', recommended: true }, { id: 'no', label: '还是先问我' }],
    actionId: `loop-offer:${topic}:${since}`,
    context: { topic },
    basis: 'hard_line',
    channel: 'popup',
  });
}

/** 他答了放手卡：点了「以后直接做」才放，记他的设备和这张卡。 */
export function offerResolver(state: AutonomyState): AskResolver {
  return {
    resolve(_changes, ask, answerer) {
      const topic = ask.context?.['topic'];
      if (ask.answer?.optionId === 'yes' && typeof topic === 'string') {
        state.loop.grants.grant(topic, answerer.deviceId, ask.id);
      }
    },
  };
}

/** 放过手的几类，写进系统提示：他知道哪些事 Plasticine 会直接做。 */
export function grantsSection(state: AutonomyState): string {
  const grants = state.loop.grants.list();
  if (grants.length === 0) {
    return '';
  }
  return ['## 他放过手的几类事', ...grants.map((grant) => `- ${grant.topic}`),
    '这几类推出来的事 ask_user 不再出卡，按推荐直接做；做完在回答里告诉他一声。他说「这类还是先问我」就用 '
      + 'loop_take_back 收回。硬线的事照样每次问。'].join('\n');
}
