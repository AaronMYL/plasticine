// 订阅的默认值（第 6、7 条）：研究周报的草案（他说一句「我想要一个……周报」，Plasticine 先给能改的草案），
// 和个人回顾（日报每天早上 8 点、周报周日晚上，11-07 定）。

import type { ResearchSettings, ReviewSettings, Subscription } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

/** 每期结构（11-06 定）。 */
export const RESEARCH_SECTIONS = ['本周概览', '重点研究', '研究方法与局限', '和你兴趣相关的发现', '值得继续追踪的问题'];

export function researchDraft(input: Partial<Omit<ResearchSettings, 'kind' | 'rules'>>): ResearchSettings {
  return {
    kind: 'research',
    topics: input.topics ?? [],
    // 基础还是临床、专业还是科普：影响大的缺口，草案里先空着，追问他。
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

/** 个人回顾只有一个，固定编号。 */
export const REVIEW_SUBSCRIPTION_ID = 'sub-review';
// 日报接在前一晚做梦之后；周报周日晚上（11-07 定「周日晚上」，取 21:00）。
export const DEFAULT_REVIEW: ReviewSettings = {
  kind: 'review',
  daily: { on: true, time: '08:00' },
  weekly: { on: true, weekday: 0, time: '21:00' },
  topics: [],
  sources: [],
  exclude: [],
  rules: [],
};

/** 没有就建一个（开着）；有了不动。 */
export function ensureReviewSubscription(state: Pick<StateService, 'subscriptions'>, timeZone: string): Subscription {
  return state.subscriptions.get(REVIEW_SUBSCRIPTION_ID) ?? state.subscriptions.create({
    title: '个人回顾', kind: 'review', status: 'active', settings: DEFAULT_REVIEW, timeZone,
  }, { id: REVIEW_SUBSCRIPTION_ID });
}
