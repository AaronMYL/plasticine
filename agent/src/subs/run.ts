// 「到点要做什么」（第 6、7 条）：订阅到点往它自己的一条后台线里放一条消息，后台线按这条消息写出这一期（space_write）。
// 计时器是 tasks 线的：整合时它按 schedulesOf 的时间调 runSubscription。现在「先出一期样刊」「现在出一期」也走这里。
// 研究周报用 researcher 模型，回顾用 review 模型（run.purpose，开线时交给内核，线按它取模型）。

import type { LineInputOrigin } from '../../shared/api/lines.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';
import type { ResearchSettings, ReviewSettings, SpaceEdition, Subscription } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { SubsError } from './errors.ts';
import { reviewMaterials, type ReviewMaterials, type ReviewState } from './review-materials.ts';

export type RunState = ReviewState & Pick<StateService, 'subscriptions' | 'spaces'>;

export interface SubscriptionRun {
  subscriptionId: string;
  edition: SpaceEdition | null;
  /** 第一次出时开的后台线叫什么。 */
  lineTitle: string;
  /** 放进后台线的那条消息。 */
  message: string;
  purpose: Extract<ModelPurpose, 'researcher' | 'review'>;
  origin: LineInputOrigin;
}

/** 后台线那一头：开线、往线里放一条消息。app 用 LineKernel 实现。 */
export interface RunPort {
  /** parentLineId：从对话里叫出来的（样刊、加刊）写完贴回那条线；到点出的是 null。 */
  open(input: { title: string; goal: string; origin: LineInputOrigin; purpose: SubscriptionRun['purpose'];
    parentLineId: string | null }): string;
  /** 往已有的线里放一条消息；线不在了（删了、找不到）返回 false，由这里另开一条。 */
  tell(lineId: string, text: string): boolean;
}

const PREPRINTS = { skip: '不收预印本', mark: '收预印本，但标出来', include: '预印本照常收' } as const;
const FOCUS = { basic: '偏基础研究', clinical: '偏临床应用' } as const;
const DEPTH = { expert: '写给专业读者', popular: '写成科普' } as const;

const DOC_RULES = [
  '写成一个空间：调用 space_write（subscriptionId 填上面的编号）。kicker 写「第 N 期 · 日期范围」；headline 写一句结论；',
  'stats 最多四个数字卡；每个小节用 heading 块（id 用英文短词），目录就是这些小节。',
  '图表只能用原文里的数据画，source 写清是哪篇的哪张表；自己整理出来的数据写 basis 说明怎么整理的；不编数。',
  '图片要写来源。每条说法用 [^n] 标出处，出处写进 sources（有网址写 url，站内的写 link）。',
].join('');

function rulesText(rules: readonly { text: string }[]): string {
  return rules.length === 0 ? '' : `\n长期规则（他点过「以后都这样」的，每期都照做）：\n${rules
    .map((rule) => `- ${rule.text}`).join('\n')}`;
}

function researchMessage(subscription: Subscription, settings: ResearchSettings, issue: number): string {
  const lines = [
    `写《${subscription.title}》第 ${issue} 期。订阅编号：${subscription.id}。`,
    `关注：${settings.topics.join('、') || '（草案里还没定，按标题理解）'}。`,
    [settings.focus === null ? '' : FOCUS[settings.focus], settings.depth === null ? '' : DEPTH[settings.depth],
      PREPRINTS[settings.preprints]].filter((part) => part !== '').join('；') + '。',
    settings.sources.length === 0 ? '' : `信息源：${settings.sources.join('、')}。`,
    settings.filter === '' ? '' : `筛选标准：${settings.filter}`,
    settings.output === '' ? '' : `输出要求：${settings.output}`,
    `每期按这几个小节写：${settings.sections.map((name, index) => `${index + 1}. ${name}`).join(' ')}`,
    rulesText(settings.rules),
    '先查最近一周的新研究，读原文再写；读过几篇、几篇是重点、几篇和他的兴趣有关，写进数字卡。',
    DOC_RULES,
  ];
  return lines.filter((line) => line !== '').join('\n');
}

function materialsText(materials: ReviewMaterials): string {
  const entries = materials.entries.map((entry) => `- [${entry.day} ${entry.kind}] ${entry.text}`
    + (entry.links.length === 0 ? '' : `（出处：${entry.links.map((link) => `${link.kind}:${link.id}`).join('，')}）`));
  const projects = materials.projects.map((project) => `- 项目「${project.name}」（project:${project.id}）：`
    + project.events.join('；'));
  const interests = materials.interests.map((item) => `- ${item.label}（${{ explicit: '明确关注', saved: '收藏',
    project: '正在推进的项目', talk: `交流里 ${item.days ?? 0} 天出现过` }[item.why]}）`);
  const dream = materials.dream === null ? '没有昨晚的整理：不写「昨晚整理了什么」这一节。'
    : `昨晚整理了 ${materials.dream.total} 条记忆：新加 ${materials.dream.add}、替换 ${materials.dream.replace}、`
      + `拿不准 ${materials.dream.unsure}、走不通的路 ${materials.dream.deadEnd}。写一节「昨晚整理了什么」，`
      + '出处写 link {kind: "memory_doc"} 或说明在记忆页的「昨晚整理」里。';
  return [
    `范围：${materials.from} 到 ${materials.to}。`,
    `今天的记录（${entries.length} 条）：`, ...entries,
    `有动态的项目：`, ...projects,
    `他的兴趣（按优先级）：`, ...interests,
    `外部新信息看这些方向：${materials.sources.join('、') || '按上面的兴趣'}。`,
    dream,
  ].join('\n');
}

function reviewMessage(subscription: Subscription, settings: ReviewSettings, edition: SpaceEdition,
  materials: ReviewMaterials): string {
  const daily = edition === 'daily';
  return [
    `写个人回顾的${daily ? '日报' : '周报'}。订阅编号：${subscription.id}，edition 填 ${edition}。`,
    '目的：帮他发现值得回顾、继续推进、进一步了解的事，不是把聊天记录重新总结一遍。',
    daily ? '日报讲当天进展、待续问题、下一步。当天没有值得回顾的就不写（不调 space_write），只回一句「今天跳过，并进周报」。'
      : '周报讲跨天的变化、反复出现的主题、项目之间的联系，不是七份日报拼起来。',
    '分两节：「来自交流」（反复讨论的问题、已形成的决定、有明确进展的项目、一直没解决的问题）和「外部新信息」'
      + '（他关注方向上的新研究），各附来源；每条重要结论用 [^n] 标出处，能点回原对话（link {kind: "message", '
      + 'id: "line:…"}）、项目（link {kind: "project"}）或原始资料（url）。',
    '值得跟进的事写进最后一节「值得跟进」。只读：不改项目状态、不建任务、不对外发消息。',
    rulesText(settings.rules),
    materialsText(materials),
    DOC_RULES,
  ].filter((line) => line !== '').join('\n');
}

/** 这一次要放进后台线的消息。review 必须说是日报还是周报。 */
export function buildRun(state: RunState, subscription: Subscription, at: Date,
  edition: SpaceEdition | null): SubscriptionRun {
  const origin: LineInputOrigin = { kind: 'trigger', ref: `subscription:${subscription.id}` };
  const { settings } = subscription;
  if (settings.kind === 'research') {
    const issue = state.spaces.nextIssueNumber(subscription.id);
    return { subscriptionId: subscription.id, edition: null, lineTitle: subscription.title, purpose: 'researcher',
      message: researchMessage(subscription, settings, issue), origin };
  }
  if (edition === null) {
    throw new SubsError('invalid', '个人回顾要说是日报还是周报。');
  }
  const materials = reviewMaterials(state, settings, edition, at, subscription.timeZone);
  return { subscriptionId: subscription.id, edition, lineTitle: subscription.title, purpose: 'review',
    message: reviewMessage(subscription, settings, edition, materials), origin };
}

/** 到点（或他点了「现在出一期」）：把这一期的消息放进订阅自己的后台线，没有线就开一条；记下线和时间。 */
export function runSubscription(state: RunState, port: RunPort, subscriptionId: string, at: Date,
  edition: SpaceEdition | null = null, parentLineId: string | null = null): { lineId: string; run: SubscriptionRun } {
  const subscription = state.subscriptions.get(subscriptionId);
  if (subscription === undefined) {
    throw new SubsError('not_found', '没有这个订阅。');
  }
  const run = buildRun(state, subscription, at, edition);
  let lineId = subscription.lineId;
  if (lineId === null || !port.tell(lineId, run.message)) {
    lineId = port.open({ title: run.lineTitle, goal: run.message, origin: run.origin, purpose: run.purpose,
      parentLineId });
  }
  const current = state.subscriptions.require(subscriptionId);
  state.subscriptions.update(subscriptionId, current.version, { lineId, lastRunAt: at.toISOString() });
  return { lineId, run };
}
