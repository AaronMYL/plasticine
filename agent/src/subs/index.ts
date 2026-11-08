// subs/：空间与订阅（《优化清单》第 6、7 条，11-06 定，11-07 补）。Plasticine 写的都是空间；订阅（研究周报、个人回顾）
// 是任务设置，每一期是一个空间。外面只经这里：app/ 挂接口，assemble 把工具交给内核，tasks 线的计时器读 schedulesOf、
// 到点调 runSubscription。

export { SubsError } from './errors.ts';
export type { SubsErrorCode } from './errors.ts';
export { checkSpaceDoc, docFromMarkdown, summaryOf } from './space-doc.ts';
export { nextRunAt, schedulesOf } from './schedule.ts';
export type { SubscriptionSlot } from './schedule.ts';
export { rankInterests, TALK_MIN_DAYS } from './interests.ts';
export type { Interest, InterestInput, InterestWhy } from './interests.ts';
export { adoptRule, changeSubscription, writeSpace } from './writes.ts';
export type { SpaceState, SpaceWrite, SubscriptionChange } from './writes.ts';
export { DEFAULT_REVIEW, ensureReviewSubscription, RESEARCH_SECTIONS, researchDraft, REVIEW_SUBSCRIPTION_ID }
  from './defaults.ts';
export { reviewMaterials } from './review-materials.ts';
export type { ReviewEntry, ReviewMaterials, ReviewState } from './review-materials.ts';
export { buildRun, runSubscription } from './run.ts';
export type { RunPort, RunState, SubscriptionRun } from './run.ts';
export { spacePath, subsTools } from './tools.ts';
export { SAMPLE_CARD_PURPOSE, SampleCards, scheduleText } from './sample-card.ts';
export type { SampleCardOptions, SampleCardState } from './sample-card.ts';
export type { ToolState } from './tools.ts';
export { SubscriptionTimed } from './timed.ts';
export type { SubsTimedLines, SubsTimedOptions, SubsTimedState } from './timed.ts';
export { followUps } from './follow-ups.ts';
export type { FollowUp } from './follow-ups.ts';
