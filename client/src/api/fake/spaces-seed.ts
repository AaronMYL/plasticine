// 假空间与订阅（设计稿 Library-Space / Library-Subscription / Feed / Main「回顾」，11-06）：认知与神经科学研究周报
// 第 1、2 期（第 2 期刚被 Plasticine 改过：图从 4 张减到 1 张）、个人回顾日报和周报、两个一般空间。内容是示例。

import type { SpaceDoc, SpaceKind, Subscription } from '../shared.ts';

export interface SeedSpace {
  id: string;
  title: string;
  kind: SpaceKind;
  author: 'user' | 'ai';
  subscriptionId: string | null;
  issueNumber: number | null;
  edition: 'daily' | 'weekly' | null;
  doc: SpaceDoc;
  createdAt: string;
  updatedAt: string;
  /** 每一版的正文，最后一个是现在的；带着「改了什么」和规则。 */
  revisions: { doc: SpaceDoc; change: string | null; rule: string | null }[];
}

export const RESEARCH_ID = 'sub_research';
export const REVIEW_ID = 'sub-review';

function ago(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

const ISSUE_TWO: SpaceDoc = {
  kicker: '第 2 期 · 11月2日–11月8日',
  headline: '本周最值得看的：睡眠中的记忆重放，第一次在人脑里被直接测到',
  stats: [{ value: '14', label: '篇读过' }, { value: '5', label: '篇重点' }, { value: '2', label: '篇和你有关' }],
  blocks: [
    { type: 'heading', id: 'overview', text: '本周概览' },
    { type: 'text', markdown: '这周的重心在睡眠和记忆巩固。最硬的一项是颅内记录：学完新路线的那晚，海马体里同一段放电'
      + '顺序反复出现，次日记得越好，重放越多[^1]。' },
    { type: 'heading', id: 'key', text: '重点研究' },
    { type: 'text', markdown: '重放和次日表现的关系不是线性的：前 10 次几乎没差别，之后才明显上升。' },
    { type: 'chart', kind: 'line', title: '学完后各晚的重放次数与次日回忆正确率', x: [0, 5, 10, 15, 20, 25, 30],
      series: [{ name: '次日回忆正确率', values: [41, 44, 43, 52, 63, 71, 69] }], unit: '%',
      caption: '每晚重放次数 → 次日回忆正确率', source: { label: '论文表 2（18 人）', url: 'https://example.org/replay' } },
    { type: 'heading', id: 'methods', text: '方法与局限' },
    { type: 'text', markdown: '被试都是癫痫术前监测的病人，只有 18 人；电极位置由治疗决定，不是为实验选的。'
      + '结论能不能推到健康人身上，还要看下一步的无创记录[^2]。' },
    { type: 'quote', text: 'Replay rate predicted next-day recall only above a threshold.',
      source: { label: 'Nature Neuroscience · 讨论部分', url: 'https://example.org/replay' } },
    { type: 'heading', id: 'yours', text: '和你有关' },
    { type: 'text', markdown: '你在笔记里记过「午睡后记单词更牢」。这篇的阈值效应可以解释为什么短午睡效果不稳。' },
    { type: 'heading', id: 'follow', text: '值得继续追踪' },
    { type: 'text', markdown: '- 无创的重放测量（高密度脑电）什么时候能做到个体水平\n- 老年人的重放是不是变少' },
  ],
  sources: [
    { label: 'Nature Neuroscience 2026 · 颅内记录的记忆重放', url: 'https://example.org/replay' },
    { label: 'eLife 2026 · 无创重放检测的综述', url: 'https://example.org/elife' },
  ],
};

const ISSUE_ONE: SpaceDoc = {
  kicker: '第 1 期 · 10月26日–11月1日',
  headline: '预测加工：大脑先猜，再拿感觉去对',
  stats: [{ value: '11', label: '篇读过' }, { value: '4', label: '篇重点' }],
  blocks: [{ type: 'heading', id: 'overview', text: '本周概览' },
    { type: 'text', markdown: '这一期是样刊：先看结构合不合适。' }],
  sources: [],
};

function review(headline: string, kicker: string, sections: [string, string][]): SpaceDoc {
  return { kicker, headline, stats: [], sources: [{ label: '主线 · 11月6日', link: { kind: 'message', id: 'line:main:3' } }],
    blocks: sections.flatMap(([title, text], index) => [{ type: 'heading' as const, id: `s${index + 1}`, text: title },
      { type: 'text' as const, markdown: text }]) };
}

export function spaceSeeds(now: Date): SeedSpace[] {
  const daily = review('侧栏方案定稿；悬赏还缺赏金来源，卡了三天', '日报 · 11月7日', [
    ['来自交流', '- 侧栏改成图标栏 + 第二栏，已经定稿[^1]\n- Cyber Hunter 的赏金从哪来，连着三天没有结论'],
    ['外部新信息', '- 两篇关于睡眠与记忆巩固的新研究，见研究周报第 2 期'],
    ['昨晚整理了什么', '新加 7 条、替换 3 条、拿不准 2 条，去记忆页的「昨晚整理」看。'],
    ['值得跟进', '- 先定赏金来源的两个候选，再写验收'],
  ]);
  const weekly = review('这周反复回到两件事：侧栏和赏金', '周报 · 10月27日–11月2日', [
    ['来自交流', '- 侧栏讨论了四天，从三栏收到两层[^1]'], ['外部新信息', '- 记忆巩固方向有三篇新研究'],
  ]);
  const plain = (id: string, title: string, markdown: string, hours: number): SeedSpace => {
    const doc: SpaceDoc = { stats: [], sources: [], blocks: [{ type: 'text', markdown }] };
    return { id, title, kind: 'space', author: 'ai', subscriptionId: null, issueNumber: null, edition: null, doc,
      createdAt: ago(now, hours), updatedAt: ago(now, hours), revisions: [{ doc, change: null, rule: null }] };
  };
  const issue = (id: string, title: string, doc: SpaceDoc, sub: string, number: number,
    edition: SeedSpace['edition'], hours: number, revisions?: SeedSpace['revisions']): SeedSpace => ({
    id, title, kind: sub === REVIEW_ID ? 'review' : 'research', author: 'ai', subscriptionId: sub, issueNumber: number,
    edition, doc, createdAt: ago(now, hours), updatedAt: ago(now, hours / 2),
    revisions: revisions ?? [{ doc, change: null, rule: null }] });
  return [
    issue('sp_research_2', '研究周报 · 第 2 期', ISSUE_TWO, RESEARCH_ID, 2, null, 30, [
      { doc: ISSUE_TWO, change: null, rule: null },
      { doc: ISSUE_TWO, change: '图从 4 张减到 1 张', rule: '每期最多 1 张图' }]),
    issue('sp_daily_1107', '日报 · 11月7日', daily, REVIEW_ID, 2, 'daily', 6),
    issue('sp_weekly_1102', '周报 · 11月2日', weekly, REVIEW_ID, 1, 'weekly', 120),
    plain('sp_bounty', '悬赏规则草稿', '## 验收\n\n接单的人交付后，发单人 48 小时内验收。', 50),
    plain('sp_visa', '马来西亚签证核查', 'DE Rantau 数字游民签证：年收入门槛 2.4 万美元。', 70),
    issue('sp_research_1', '研究周报 · 第 1 期', ISSUE_ONE, RESEARCH_ID, 1, null, 200),
  ];
}

export function subscriptionSeeds(now: Date): Subscription[] {
  const at = ago(now, 300);
  return [
    { id: REVIEW_ID, createdAt: at, updatedAt: at, version: 1, title: '个人回顾', kind: 'review', status: 'active',
      timeZone: 'Asia/Shanghai', lineId: null, lastRunAt: ago(now, 6),
      settings: { kind: 'review', daily: { on: true, time: '08:00' }, weekly: { on: true, weekday: 0, time: '21:00' },
        topics: ['记忆巩固'], sources: [], exclude: [], rules: [] } },
    { id: RESEARCH_ID, createdAt: at, updatedAt: at, version: 3, title: '认知与神经科学研究周报', kind: 'research',
      status: 'active', timeZone: 'Asia/Shanghai', lineId: 'line_research', lastRunAt: ago(now, 30),
      settings: { kind: 'research', topics: ['记忆巩固', '睡眠', '预测加工', '注意力的神经机制'], focus: 'basic',
        depth: 'expert', sources: ['PubMed', 'bioRxiv 神经科学', 'Nature Neuroscience', 'Neuron', 'eLife'],
        preprints: 'mark', filter: '', schedule: { every: 'week', weekday: 1, time: '09:00' },
        sections: ['本周概览', '重点研究', '方法与局限', '和你有关的发现', '值得继续追踪的问题'], output: '',
        rules: [] } },
  ];
}
