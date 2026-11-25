import type { ResearchSettings, ReviewSettings, Subscription } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

export const RESEARCH_SECTIONS = ['本周概览', '重点研究', '研究方法', '和你兴趣相关的发现', '值得继续追踪的问题'];

export function researchDraft(input: Partial<Omit<ResearchSettings, 'kind' | 'rules'>>): ResearchSettings {
  return {
    kind: 'research',
    topics: input.topics ?? [],
    focus: input.focus ?? null,
    depth: input.depth ?? null,
    sources: input.sources ?? [],
    preprints: input.preprints ?? 'mark',
    filter: input.filter ?? '',
    schedule: input.schedule ?? { every: 'week', weekday: 1, time: '09:00' },
    sections: input.sections ?? RESEARCH_SECTIONS,
    output: input.output ?? '',
    rules: [],
  };
}

export const REVIEW_SUBSCRIPTION_ID = 'sub-review';
export const DEFAULT_REVIEW: ReviewSettings = {
  kind: 'review',
  daily: { on: true, time: '08:00' },
  weekly: { on: true, weekday: 0, time: '21:00' },
  topics: [],
  sources: [],
  exclude: [],
  rules: [],
};

export function ensureReviewSubscription(state: Pick<StateService, 'subscriptions'>, timeZone: string): Subscription {
  return state.subscriptions.get(REVIEW_SUBSCRIPTION_ID) ?? state.subscriptions.create({
    title: '个人回顾', kind: 'review', status: 'active', settings: DEFAULT_REVIEW, timeZone,
  }, { id: REVIEW_SUBSCRIPTION_ID });
}
