import type { Ask } from '../../shared/state.ts';
import type { AskDesk, AskResolver, Changes } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import { canonicalTopic, normalizeTopic, OFFER_STREAK, streak, type LoopOutcome } from './tally.ts';

export const OFFER_PURPOSE = 'loop_offer';
export type AutonomyState = Pick<StateService, 'loop'>;

interface OptionLike { id: string; label: string; recommended?: boolean | undefined }

export function topicProblem(topic: string | undefined, options: readonly OptionLike[]): string | null {
  const recommended = options.some((option) => option.recommended === true);
  if (!recommended || (topic !== undefined && normalizeTopic(topic) !== null)) {
    return null;
  }
  return '带推荐项的卡要写 topic：这类事的叫法（2–8 个字，同一类每次用同一个词，如「排日程」「回邮件」）。';
}

export function askTopic(state: AutonomyState, topic: string | undefined): string | undefined {
  if (topic === undefined) {
    return undefined;
  }
  return canonicalTopic(topic, state.loop.topics('ask')) ?? undefined;
}

export function autoChoice(state: AutonomyState, topic: string | undefined, basis: string,
  options: readonly OptionLike[]): OptionLike | null {
  const name = topic === undefined ? null : normalizeTopic(topic);
  if (name === null || basis !== 'inferred' || state.loop.grants.active(name) === undefined) {
    return null;
  }
  return options.find((option) => option.recommended === true) ?? null;
}

export function recordAsk(state: AutonomyState, ask: Ask, topic: string | undefined): void {
  const name = topic === undefined ? null : normalizeTopic(topic);
  const recommended = ask.options.find((option) => option.recommended);
  if (name === null || recommended === undefined) {
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

export function settleAsk(state: AutonomyState, ask: Ask, topic: string | undefined): string | null {
  const name = topic === undefined ? null : normalizeTopic(topic);
  const outcome = outcomeOf(ask);
  if (name === null || outcome === null || !ask.options.some((option) => option.recommended)) {
    return null;
  }
  state.loop.resolveByRef('ask', ask.id, outcome, ask.answer?.label ?? null);
  if (ask.basis !== 'inferred' || outcome !== 'kept' || state.loop.grants.active(name) !== undefined
    || state.loop.offers.open(name)) {
    return null;
  }
  const since = [state.loop.grants.lastRevokedAt(name), state.loop.offers.lastDeclinedAt(name)]
    .filter((at): at is string => at !== null).sort().at(-1) ?? null;
  return streak(state.loop.outcomes('ask', name, OFFER_STREAK, since)) >= OFFER_STREAK ? name : null;
}

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

export function grantsSection(state: AutonomyState): string {
  const grants = state.loop.grants.list();
  if (grants.length === 0) {
    return '';
  }
  return ['## 他放过手的几类事', ...grants.map((grant) => `- ${grant.topic}`),
    '这几类推出来的事 ask_user 不再出卡，按推荐直接做；做完在回答里告诉他一声。他说「这类还是先问我」就用 '
      + 'loop_take_back 收回。硬线的事照样每次问。'].join('\n');
}
