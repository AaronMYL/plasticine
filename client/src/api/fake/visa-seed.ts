// 《优化清单》第 17 条的演示数据（11-07 设计稿 Plasticine-Main / Side / Phone）：主线查马来西亚数字游民签证——子代理
// 卡「做了 7 步」、隔一段一条的进度、先说判断的长回答、一句回复、在做的子代理；旁聊列表，第一条从信息流开。?scene=visa。

import type { LineMessageView } from '../shared.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';

type Draft = Omit<LineMessageView, 'lineId' | 'seq'>;

function message(at: Date, fields: Partial<LineMessageView>): Draft {
  return { role: 'assistant', origin: null, text: '', thinking: null, thinkingMs: null, steps: [],
    toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null,
    attachments: [], widgets: [], reactions: [], replyTo: null, createdAt: at.toISOString(), ...fields };
}

const ANSWER = '**先说判断：**你大概率符合，关键看收入证明能不能按月开出来。\n\n'
  + '### 主线一：DE Rantau 数字游民\n\n'
  + '- 月收入不低于 2,000 美元，需要远程工作合同或客户付款记录'
  + '（[MDEC 官方说明](https://mdec.my/derantau)）。\n'
  + '- 期限 3–12 个月，可再续 12 个月；可以带家属。\n\n'
  + '### 备选：先用免签入境\n\n'
  + '- 中国护照现在免签 30 天（[使馆公告](https://www.mfa.gov.cn)），适合先去看看再决定。\n\n'
  + '拿不准的：我不知道你能动用多少存款，没法替你判断银行流水那一项。';

const STEPS: ReadonlyArray<[string, string, string]> = [
  ['cloud_browser_open', '打开他发的链接', '打不开'],
  ['cloud_browser_open', '搜「DE Rantau」', '官方页面在第一条'],
  ['cloud_browser_read', '读 MDEC 的申请条件', '收入门槛按月算'],
  ['cloud_browser_read', '读常见问题', '可以带家属'],
  ['cloud_browser_read', '读使馆公告', '免签 30 天'],
  ['note_search', '找他的收入记录在哪', '在「个人」项目里'],
  ['remember', '记下他在看签证', '记下了'],
];

function seedChild(lines: FakeLines, id: string, title: string, at: Date, fields: Partial<Parameters<
  FakeLines['blank']>[3]>): void {
  lines.put(lines.blank(id, 'background', title, { parentLineId: MAIN_LINE_ID, createdAt: at.toISOString(),
    updatedAt: at.toISOString(), ...fields }));
}

function seedMain(lines: FakeLines, now: Date): void {
  const at = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);
  const ask = '帮我查一下马来西亚的数字游民签证，现在什么要求，我能不能申请';
  lines.record(MAIN_LINE_ID, message(at(12), { role: 'user', text: ask }), { kind: 'user', userText: ask });
  const opened = lines.record(MAIN_LINE_ID, message(at(12), { text: '先看官方说明，再对照你的情况。',
    stopReason: 'toolUse', steps: [{ toolCallId: 'visa-start', tool: 'start_line', say: '开一条线：查签证' }] }));
  seedChild(lines, 'line-visa', '查 DE Rantau 签证的现行条件', at(12), { parentMessageSeq: opened.seq,
    outcome: 'done', lastAnswer: '收入门槛今年改成按月算了。', updatedAt: at(8).toISOString() });
  lines.record('line-visa', message(at(12), { steps: STEPS.map(([tool, say], index) => ({
    toolCallId: `visa-${index}`, tool, say })), stopReason: 'toolUse' }));
  STEPS.forEach(([tool, say, result], index) => {
    lines.record('line-visa', message(at(11), { role: 'toolResult', tool, say, text: result,
      toolCallId: `visa-${index}`, ok: true }));
  });
  lines.record('line-visa', message(at(8), { text: '收入门槛今年改成按月算了。', stopReason: 'stop' }));
  lines.record(MAIN_LINE_ID, message(at(11), { text: '你发的链接打不开，我找到名字差一个字母的官方页面，先按这个看。' }));
  const found = lines.record(MAIN_LINE_ID, message(at(9), { text: '找到一个会影响选择的细节：收入门槛今年改成按月算了。' }));
  lines.record(MAIN_LINE_ID, message(at(8), { text: ANSWER, stopReason: 'stop', reactions: [] }));
  const reply = '我是按项目结的，每个月不固定';
  lines.record(MAIN_LINE_ID, message(at(3), { role: 'user', text: reply,
    replyTo: { seq: found.seq, author: 'Plasticine', text: '收入门槛今年改成按月算了' } }),
  { kind: 'user', userText: reply });
  const plan = lines.record(MAIN_LINE_ID, message(at(3), { text: '那就用最近 12 个月的流水按月平均，我先按这个口径算一下。',
    stopReason: 'toolUse', steps: [{ toolCallId: 'visa-income', tool: 'start_line', say: '开一条线：算收入' }] }));
  seedChild(lines, 'line-income', '按月平均你最近 12 个月的收入', at(3), { parentMessageSeq: plan.seq,
    status: 'running', activity: '正在读 10 月的到账记录', activeSince: at(3).toISOString() });
  lines.change(MAIN_LINE_ID, { status: 'idle', lastAnswer: '研究周报第 3 期在做，读到第 9 篇' });
}

function seedSides(lines: FakeLines, now: Date): void {
  const day = (days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString();
  const side = (id: string, title: string, days: number): void => {
    lines.put(lines.blank(id, 'side', title, { createdAt: day(days), updatedAt: day(days) }));
  };
  side('line-side-visa', '马来西亚数字游民签证', 5);
  side('line-side-bounty', 'Cyber Hunter 赏金从哪来', 4);
  side('line-side-arc', 'Arc 的竖排标签怎么做', 1);
  lines.put(lines.blank('line-side-sleep', 'side', '讨论：睡眠中的记忆重放', { createdAt: day(2), updatedAt: day(0.5),
    topic: { kind: 'feed', ref: 'feed-sleep', title: '睡眠中的记忆重放第一次在人脑里被直接测到', source: 'bioRxiv',
      at: day(2), excerpt: '颅内电极记录 18 名受试者；学完新路线的那晚，海马体里同一段放电顺序反复出现，次日记得越好重放越多。' } }));
  const at = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);
  lines.record('line-side-sleep', message(at(40), { role: 'user', text: '18 个人的样本够吗？' }),
    { kind: 'user', userText: '18 个人的样本够吗？' });
  lines.record('line-side-sleep', message(at(39), { stopReason: 'stop', text: '对颅内记录来说不算小：这类数据只能从'
    + '癫痫手术病人身上取，同类研究常见 10 人上下。\n\n要打折扣的是另外两点：\n\n- 受试者都是癫痫病人，海马体本身可能'
    + '和常人不同。\n- 还是预印本，没有经过同行评审（[bioRxiv 页面](https://www.biorxiv.org)）。\n\n'
    + '想的话，我把它放进研究周报下一期的「值得继续追踪」。' }));
}

/** 演示「n 条新消息」：过一会儿算收入的子代理做完，交回结论（只有一段话）。 */
const INCOME_DONE_MS = 4_000;

function finishIncome(lines: FakeLines): void {
  const at = new Date();
  lines.change('line-income', { status: 'idle', outcome: 'done', activity: null, activeSince: null,
    lastAnswer: '最近 12 个月按月平均约 2,600 美元。' });
  lines.record(MAIN_LINE_ID, message(at, { role: 'lineReport', childLineId: 'line-income', ok: true,
    stopReason: 'done', text: '按最近 12 个月的到账算，月均约 2,600 美元，过了 2,000 的门槛；有两个月低于门槛，'
      + '申请时附上合同说明项目结算周期。' }));
}

export function seedVisa(lines: FakeLines, now: Date): void {
  seedSides(lines, now);
  seedMain(lines, now);
  setTimeout(() => finishIncome(lines), INCOME_DONE_MS);
}
