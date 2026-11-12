// 本地开发和截图的任务栏目（设计稿 Tasks-Run、Tasks-Timed、Tasks-Ideas、Plasticine-Schedule）：定时七行、队友五位、
// 建议四张；?scene=tasks 换上稿子里的在做三条和刚做完两条；?scene=schedule 是主线里那张抖音续火花的定时卡。

import { STANDING_PROJECT_IDS, type LineView, type SuggestionView, type TeammateView, type TimedRowView }
  from '../shared.ts';
import type { AskSeed } from './fake-asks.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';
import type { FakeTasks } from './fake-tasks.ts';

const PERSONAL = STANDING_PROJECT_IDS.personal;
const PLASTICINE = STANDING_PROJECT_IDS.plasticine;
const HOUR_MS = 3_600_000;
const FRIENDS = ['小林', '阿杰', 'Mia', '周周', '老陈', 'Kiki', '阿北', '豆豆'];

function at(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * HOUR_MS).toISOString();
}

/** 某天某个钟点（本地时间）。 */
function clock(now: Date, dayOffset: number, hour: number): string {
  const day = new Date(now.getTime() + dayOffset * 24 * HOUR_MS);
  day.setHours(hour, 0, 0, 0);
  return day.toISOString();
}

type RowSeed = Pick<TimedRowView, 'id' | 'source' | 'title' | 'summary' | 'icon' | 'hue' | 'nextAt' | 'last'
  | 'enabled'> & Partial<TimedRowView>;

function row(seed: RowSeed): TimedRowView {
  return { canToggle: true, canRemove: seed.source === 'schedule' || seed.source === 'subscription',
    projectId: PERSONAL, lineId: null, askId: null, teammateId: seed.id, sheet: seed.source === 'heartbeat', ...seed };
}

export function timedSeed(now: Date): TimedRowView[] {
  return [
    row({ id: 'heartbeat', source: 'heartbeat', title: '心跳', summary: '每 30 分钟看一眼 · 23:00–08:00 不跳',
      icon: 'pulse', hue: 'slate', nextAt: clock(now, 0, 15), last: { glyph: 'done', text: '没事' }, enabled: true }),
    row({ id: 'schedule:spark', source: 'schedule', title: '抖音续火花', summary: '每天 15:00 · 以你的名义发出',
      icon: 'clock', hue: 'rose', nextAt: null, last: { glyph: 'wait', text: '等你授权' }, enabled: false,
      canToggle: false, askId: 'ask-schedule-spark' }),
    row({ id: 'schedule:douyin', source: 'schedule', title: '同步抖音收藏', summary: '每天 22:00 · 只拿标题，要电脑在线',
      icon: 'play', hue: 'rose', nextAt: clock(now, 0, 22), last: { glyph: 'err', text: '电脑不在线' }, enabled: true }),
    row({ id: 'dream', source: 'dream', title: '做梦', summary: '每晚整理记忆', icon: 'moon', hue: 'olive',
      nextAt: clock(now, 1, 1), last: { glyph: 'done', text: '整理了 11 条' }, enabled: true }),
    row({ id: 'review:daily', source: 'review', title: '日报', summary: '每天 08:00 · 个人回顾', icon: 'sparkle',
      hue: 'teal', nextAt: clock(now, 1, 8), last: { glyph: 'done', text: '已出' }, enabled: true, teammateId: 'review' }),
    row({ id: 'review:weekly', source: 'review', title: '周报', summary: '周日 21:00 · 个人回顾', icon: 'sparkle',
      hue: 'teal', nextAt: clock(now, 1, 21), last: { glyph: 'done', text: '已出' }, enabled: true,
      teammateId: 'review' }),
    row({ id: 'subscription:neuro', source: 'subscription', title: '认知与神经科学研究周报', summary: '周一 09:00 · 订阅',
      icon: 'space', hue: 'sky', nextAt: null, last: { glyph: 'pause', text: '暂停了' }, enabled: false,
      teammateId: 'researcher', projectId: PLASTICINE }),
  ];
}

function mate(seed: Omit<TeammateView, 'canStop' | 'lineId'> & Partial<TeammateView>): TeammateView {
  return { canStop: seed.glyph !== 'pause', lineId: null, ...seed };
}

export function teammatesSeed(): TeammateView[] {
  return [
    mate({ id: 'heartbeat', name: '心跳', icon: 'pulse', hue: 'slate', glyph: 'idle', now: '14:30 看过，没事',
      rowIds: ['heartbeat'] }),
    mate({ id: 'dream', name: '做梦', icon: 'moon', hue: 'olive', glyph: 'idle', now: '昨晚整理了 11 条',
      rowIds: ['dream'] }),
    mate({ id: 'researcher', name: '研究员', icon: 'space', hue: 'sky', glyph: 'run', now: '周报第 3 期 · 9 / 14',
      rowIds: ['subscription:neuro'], lineId: 'line-weekly' }),
    mate({ id: 'review', name: '回顾', icon: 'sparkle', hue: 'teal', glyph: 'idle', now: '早上 8:00 出了日报',
      rowIds: ['review:daily', 'review:weekly'] }),
    mate({ id: 'schedule:douyin', name: '抖音同步', icon: 'play', hue: 'rose', glyph: 'pause', now: '等电脑上线',
      rowIds: ['schedule:douyin'] }),
  ];
}

export function ideasSeed(now: Date): SuggestionView[] {
  const idea = (id: string, title: string, why: string, icon: SuggestionView['icon'], hours: number,
    projectId: string | null = null): SuggestionView => ({ id, title, why, icon, source: 'plasticine', projectId,
    createdAt: at(now, -hours) });
  return [
    idea('idea-rules', '把悬赏规则整理成公开页', '这周你三次说「悬赏规则还没写清」；开源仓库公开前要有这一页。', 'file', 1),
    idea('idea-biorxiv', '研究周报加一个来源：bioRxiv 神经科学', '上两期 5 篇重点里有 3 篇来自这里的预印本。', 'space', 2,
      PLASTICINE),
    idea('idea-review', '回复「下周三的评审会」邀请', '周老师昨天发来；你日历上那天下午空着。', 'mail', 3),
    idea('idea-book', '给《思考，快与慢》做一页读书笔记', '读到 63%，标注了 21 处，还没整理过。', 'books', 4),
  ];
}

export function seedTasks(tasks: FakeTasks, now: Date): void {
  tasks.seed({ timed: timedSeed(now), teammates: teammatesSeed(), ideas: ideasSeed(now) });
  tasks.heartbeats.seed(now);
}

/** ?scene=tasks：稿子里的在做三条、刚做完两条（其中一条没做成，带原因）。 */
export function seedTasksLines(lines: FakeLines, now: Date, projectId: string | null): void {
  const put = (id: string, title: string, fields: Partial<LineView>): void => {
    lines.put(lines.blank(id, 'background', title, { parentLineId: MAIN_LINE_ID, createdAt: at(now, -1),
      updatedAt: at(now, -1), ...fields }));
  };
  const minutes = (count: number): string => new Date(now.getTime() - count * 60_000).toISOString();
  put('line-weekly', '研究周报 · 第 3 期', { status: 'running', activity: '读到第 9 / 14 篇：《海马体重放与次日回忆》',
    activeSince: minutes(12), projectId });
  put('line-rules', '整理 Cyber Hunter 悬赏规则', { status: 'running', activity: '写到「验收」一节',
    activeSince: minutes(4), projectId });
  put('line-income', '按月平均最近 12 个月的收入', { status: 'running', activity: '正在读 10 月的到账记录',
    activeSince: minutes(1), projectId: PERSONAL });
  put('line-feed', '刷新信息流', { status: 'idle', outcome: 'done', lastAnswer: '新增 12 条', updatedAt: at(now, -2) });
  put('line-spark', '设置每日续火花', { status: 'idle', outcome: 'done', unmet: '当时还不能新建定时任务',
    updatedAt: at(now, -26) });
}

const SPARK_SAID = '帮我加一个定时任务，每天下午 3 点，抖音聊天里面，帮我给 8 个人续火花，发一个表情就行了。';

/** ?scene=schedule：他说了一句，Plasticine 起草好抖音续火花的定时卡，等他确认。 */
export function scheduleAsk(): AskSeed {
  return {
    id: 'ask-schedule-spark',
    kind: 'approve',
    question: '每天 15:00 · 抖音续火花',
    detail: '确认后，每天会以你的名义发出。只发给这 8 位、只发表情；超出这张卡的，照旧先问你。',
    basis: 'hard_line',
    lineId: MAIN_LINE_ID,
    options: [{ id: 'confirm', label: '确认，每天照做', recommended: true, description: null },
      { id: 'revise', label: '改名单', recommended: false, description: null }],
    scheduleCard: { scheduleId: 'spark', title: '抖音续火花', when: '每天 15:00', who: FRIENDS,
      what: '每人一个表情，每天随机换', place: '你的 Mac（不在线就等上线补发，当天 23:00 前）',
      report: '只在有人发不出去时告诉你', projectName: '个人', outward: true, replaces: false },
  };
}

export function seedScheduleScene(lines: FakeLines, raiseAsk: (seed: AskSeed) => void, now: Date): void {
  const said = new Date(now.getTime() - 60_000).toISOString();
  lines.record(MAIN_LINE_ID, { role: 'user', text: SPARK_SAID, origin: { kind: 'user', userText: SPARK_SAID },
    thinking: null, thinkingMs: null, steps: [],
    toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null,
    attachments: [], widgets: [], createdAt: said });
  lines.record(MAIN_LINE_ID, { role: 'assistant', text: '好。我按火花天数在你的抖音私信里挑了前 8 位，你看一下名单：',
    thinking: null, thinkingMs: null, steps: [{ toolCallId: 'sp1', tool: 'schedule_propose', say: '起草定时卡：抖音续火花' }],
    toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: 'toolUse', childLineId: null,
    attachments: [], widgets: [], createdAt: now.toISOString() });
  lines.change(MAIN_LINE_ID, { status: 'waiting', activity: null, activeSince: said });
  raiseAsk(scheduleAsk());
}

const SAMPLE_SAID = '每周五为我整理认知科学、神经科学、意识的最新重要研究，重点解读原始论文。';
const SAMPLE_REPORT = '**第 1 期样刊写好了。** 重点解读 2 篇原始研究：1 篇 Nature Neuroscience 正式论文、'
  + '1 篇未评审预印本，已分开标出。\n\n[认知科学与意识研究周报 · 第 1 期](https://203.0.113.10/#/books/space/space-sample)';

/** 第 7 批第 14 条（设计稿 Chat-Sample）：样刊写完，主线最下面摊着「每周五 08:00 出一期」的卡。 */
export function seedSampleScene(lines: FakeLines, raiseAsk: (seed: AskSeed) => void, now: Date): void {
  const said = new Date(now.getTime() - 120_000).toISOString();
  lines.record(MAIN_LINE_ID, { role: 'user', text: SAMPLE_SAID, origin: { kind: 'user', userText: SAMPLE_SAID },
    thinking: null, thinkingMs: null, steps: [],
    toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null,
    attachments: [], widgets: [], createdAt: said });
  lines.record(MAIN_LINE_ID, { role: 'assistant', text: SAMPLE_REPORT, thinking: null, thinkingMs: null, steps: [],
    toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: 'stop', childLineId: null,
    attachments: [], widgets: [], createdAt: now.toISOString() });
  raiseAsk({ id: 'ask-sample-card', kind: 'decide', question: '每周五 08:00 出一期', detail: '认知科学与意识研究周报',
    basis: 'inferred', lineId: null,
    options: [{ id: 'start', label: '开启定时', recommended: true, description: null },
      { id: 'revise', label: '再改改', recommended: false, description: null }],
    subscriptionCard: { subscriptionId: 'sub-cogsci', title: '认知科学与意识研究周报', when: '每周五 08:00 出一期',
      spaceId: 'space-sample', issueNumber: 1 } });
}
