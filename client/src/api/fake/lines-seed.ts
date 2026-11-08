// 本地开发和截图的线（2026-11-05 设计稿 Main / Steps / Waiting）：主对话上一轮查 CuaDriver（想了 12 秒、做了 6 步、
// 普通文字的回答），这一轮在干活（一行实时状态，输入框上方排着一条）；两条后台线在做、几条做完了。
// 地址带 ?scene= 换成另几个样子：steps（步骤 + 后台线卡片）、waiting（硬线要你定卡 + 出错一行）、paused（额度用完）、
// failed（连不上模型，可重试）。

import type { AskSeed } from './fake-asks.ts';
import type { LineMessageView, LineView } from '../shared.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';
import { seedChat } from './chat-seed.ts';
import { seedVisa } from './visa-seed.ts';

export type LineScene = 'working' | 'steps' | 'waiting' | 'paused' | 'failed' | 'draft' | 'chat' | 'visa';

export function lineSceneOf(search: string): LineScene {
  const value = new URLSearchParams(search).get('scene');
  return value === 'steps' || value === 'waiting' || value === 'paused' || value === 'failed' || value === 'draft'
    || value === 'chat' || value === 'visa'
    ? value : 'working';
}

export interface LinesSeedDeps {
  lines: FakeLines;
  raiseAsk: (seed: AskSeed) => void;
  /** 项目 Cyber Hunter 的 id（项目页「这个项目的线」）。 */
  projectId: string | null;
}

type Draft = Omit<LineMessageView, 'lineId' | 'seq'>;

function message(at: Date, fields: Partial<Draft>): Draft {
  return { role: 'assistant', text: '', origin: fields.role === 'user' ? { kind: 'user', userText: fields.text ?? '' }
    : null, thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null,
    say: null, ok: null, summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
    createdAt: at.toISOString(), ...fields };
}

const ago = (now: Date, seconds: number): Date => new Date(now.getTime() - seconds * 1000);

const CUA_STEPS: ReadonlyArray<[string, string, string]> = [
  ['device_action', '在 Mac 上找 CuaDriver.app', '/Applications/CuaDriver.app'],
  ['device_action', '在 Mac 上验证签名', 'Cua AI, Inc.，签名有效'],
  ['device_action', '查苹果公证', '已公证'],
  ['device_action', '看它拿了哪些权限', '辅助功能、屏幕录制'],
  ['cloud_browser_open', '搜「CuaDriver」', '官方 GitHub 在第一条'],
  ['cloud_browser_read', '读 Cua 的官方文档', 'CuaDriver 是它的 Mac 驱动'],
];

const CUA_ANSWER = 'CuaDriver.app 是 **Cua** 的 Mac 驱动：让 AI 代理能看你的屏幕、点鼠标、敲键盘。'
  + '它只听本机 Cua 的调用，自己不联网做别的事。\n\n'
  + '- **谁做的**：Cua AI, Inc.，签名有效，苹果已公证\n'
  + '- **在哪**：`/Applications/CuaDriver.app`\n'
  + '- **权限**：辅助功能、屏幕录制\n\n'
  + '不用的话，先在「系统设置 › 隐私与安全性」里关掉这两项权限，再删掉应用。';

/** 一轮：他说的话 → 想了 thinkSeconds 秒 → 几步 → 回答。返回这一轮最后的时间。 */
const CUA_THINKING = '先在 Mac 上找到它、看签名和权限，再去网上对一下官方说法。';

function turn(lines: FakeLines, lineId: string, start: Date, said: string | null, thinkSeconds: number,
  steps: ReadonlyArray<[string, string, string]>, answer: string | null, prefix: string,
  thinking: string | null = CUA_THINKING): Date {
  if (said !== null) {
    lines.record(lineId, message(start, { role: 'user', text: said }));
  }
  const thought = new Date(start.getTime() + thinkSeconds * 1000);
  const calls = steps.map(([tool, say], index) => ({ toolCallId: `${prefix}-${index}`, tool, say }));
  lines.record(lineId, message(thought, { thinking, steps: calls, stopReason: 'toolUse' }));
  steps.forEach(([tool, say, result], index) => {
    lines.record(lineId, message(new Date(thought.getTime() + (index + 1) * 4000), { role: 'toolResult',
      text: result, toolCallId: `${prefix}-${index}`, tool, say, ok: true }));
  });
  const end = new Date(thought.getTime() + (steps.length + 1) * 4000);
  if (answer !== null) {
    lines.record(lineId, message(end, { text: answer, stopReason: 'stop' }));
  }
  return end;
}

function background(lines: FakeLines, now: Date, id: string, title: string, fields: Partial<LineView>): LineView {
  return lines.put(lines.blank(id, 'background', title, { parentLineId: MAIN_LINE_ID, createdAt: ago(now, 900)
    .toISOString(), updatedAt: now.toISOString(), ...fields }));
}

function seedBackground(deps: LinesSeedDeps, now: Date): void {
  const { lines } = deps;
  background(lines, now, 'line-source', '查 CuaDriver 的安装来源', { status: 'running', activity: '读官方发布页…',
    parentLineId: null, activeSince: ago(now, 134).toISOString(), createdAt: ago(now, 134).toISOString() });
  background(lines, now, 'line-relay', '搭 Cyber Hunter 中继', { status: 'running', parentLineId: null,
    projectId: deps.projectId, activity: '在腾讯云上申请证书…', activeSince: ago(now, 760).toISOString(),
    createdAt: ago(now, 760).toISOString() });
  background(lines, now, 'line-relay-compare', '对比 3 个成熟的中继方案', { parentLineId: null, projectId: deps.projectId,
    outcome: 'done',
    lastAnswer: '选了长连接 + 信封加密', createdAt: ago(now, 86400 * 1.2).toISOString(),
    updatedAt: ago(now, 86400).toISOString() });
  background(lines, now, 'line-friends', '查三位朋友的设备', { parentLineId: null, projectId: deps.projectId,
    outcome: 'done',
    lastAnswer: 'VPS、Mac、Windows 各一位', createdAt: ago(now, 86400 * 2.2).toISOString(),
    updatedAt: ago(now, 86400 * 2).toISOString() });
  turn(lines, 'line-relay-compare', ago(now, 86400), '对比几个成熟的中继方案', 0, [],
    '选了长连接 + 信封加密。后续具体接线再核对。', 'relay-result', null);
  turn(lines, 'line-friends', ago(now, 86400 * 2), '看一下三位朋友的设备', 0, [],
    'VPS、Mac、Windows 各一位。', 'friends-result', null);
}

function seedWorking(lines: FakeLines, now: Date): void {
  turn(lines, MAIN_LINE_ID, ago(now, 300), '帮我查一下 Mac 上的 CuaDriver.app 是什么', 12, CUA_STEPS, CUA_ANSWER, 'cua');
  lines.record(MAIN_LINE_ID, message(ago(now, 23), { role: 'user', text: '它是什么时候装上的？谁装的？' }));
  lines.change(MAIN_LINE_ID, { status: 'running', activity: '在 Mac 上读 CuaDriver 的签名…',
    activeSince: ago(now, 23).toISOString() });
  lines.seedQueued(MAIN_LINE_ID, '再看看它有没有开机自启');
}

function seedSteps(lines: FakeLines, now: Date): void {
  turn(lines, MAIN_LINE_ID, ago(now, 600), '帮我查一下 Mac 上的 CuaDriver.app 是什么', 12, CUA_STEPS,
    'CuaDriver.app 是 **Cua** 的 Mac 驱动：让 AI 代理能看屏幕、点鼠标、敲键盘。签名和公证都没问题。', 'cua');
  const asked = ago(now, 200);
  turn(lines, MAIN_LINE_ID, asked, '来源这个慢慢查，查完告诉我。顺便看看还有没有别的 Cua 组件', 2,
    [['start_line', '开条线去查安装来源', '在做'], ['start_line', '开条线看别的 Cua 组件', '在做']], null, 'spawn',
    null);
  lines.put({ ...lines.find('line-source') as LineView, parentLineId: MAIN_LINE_ID,
    createdAt: ago(now, 134).toISOString() });
  lines.put(lines.blank('line-parts', 'background', '看还有没有别的 Cua 组件', { parentLineId: MAIN_LINE_ID,
    outcome: 'done',
    createdAt: ago(now, 190).toISOString(), updatedAt: ago(now, 122).toISOString(),
    lastAnswer: '只有 CuaDriver.app 一个。' }));
  lines.record(MAIN_LINE_ID, message(ago(now, 122), { role: 'lineReport', childLineId: 'line-parts',
    stopReason: 'done', text: '只有 CuaDriver.app 一个。`/Applications`、`~/Library` 和登录项里都没有别的 Cua 组件，'
      + '也没有在跑的 Cua 进程。' }));
  turn(lines, 'line-parts', ago(now, 190), null, 1, [['device_action', '在 Mac 上翻 /Applications', '只有 CuaDriver.app'],
    ['device_action', '在 Mac 上翻 ~/Library', '没有别的 Cua 组件'], ['device_action', '在 Mac 上看登录项', '没有'],
    ['device_action', '在 Mac 上看在跑的进程', '没有 Cua 进程']], '只有 CuaDriver.app 一个。', 'parts', null);
  lines.change(MAIN_LINE_ID, { lastAnswer: '只有 CuaDriver.app 一个。' });
}

const BOLT_ASK: AskSeed = { id: 'ask-line-bolt', kind: 'approve', basis: 'hard_line', lineId: MAIN_LINE_ID,
  question: '要把这封回复发给 Bolt 吗？',
  detail: ['发出后对方会收到，撤不回', '硬线：以你的名义对外发出。只放行这一次、这组参数；改了参数要再问你。',
    '「mail_send」的参数：' + JSON.stringify({ to: 'Bolt 账单组', subject: '回复「你的 Pro 方案账单」',
      body: '你好，\n我们从这个月起不再续订 Pro 方案，本期结束后请停止扣费。\n谢谢！\nAlex' })].join('\n'),
  options: [{ id: 'allow', label: '发出', recommended: true, description: null },
    { id: 'revise', label: '改一下', recommended: false, description: null },
    { id: 'deny', label: '先不', recommended: false, description: null }] };

/** 平常的样子：回 Bolt 那封信是一条后台线，停在硬线卡上等你（首页「等你」第一条）。 */
function seedBoltLine(deps: LinesSeedDeps, now: Date): void {
  background(deps.lines, now, 'line-bolt', '回 Bolt 的账单邮件', { status: 'waiting', parentLineId: null,
    activeSince: ago(now, 400).toISOString(), createdAt: ago(now, 420).toISOString() });
  deps.raiseAsk(BOLT_ASK);
}

function seedWaiting(deps: LinesSeedDeps, now: Date): void {
  const { lines } = deps;
  lines.record(MAIN_LINE_ID, message(ago(now, 3600), { role: 'user', text: '这周信息流里有什么值得看的？' }));
  lines.record(MAIN_LINE_ID, message(ago(now, 3590), { stopReason: 'error', text: '连不上模型，已重试 3 次' }));
  turn(lines, MAIN_LINE_ID, ago(now, 300), 'Bolt 那封账单邮件帮我回一下，说这个月起不续了', 3,
    [['read_inbox', '读 Bolt 的账单邮件', '你的 Pro 方案账单'], ['note_append', '写好回复', '四句话']], null, 'bolt');
  lines.change(MAIN_LINE_ID, { status: 'waiting', activity: null, activeSince: ago(now, 300).toISOString() });
  deps.raiseAsk(BOLT_ASK);
}

function seedPaused(lines: FakeLines, now: Date, failed: boolean): void {
  turn(lines, MAIN_LINE_ID, ago(now, 600), '帮我查一下 Mac 上的 CuaDriver.app 是什么', 12, CUA_STEPS, CUA_ANSWER, 'cua');
  turn(lines, MAIN_LINE_ID, ago(now, 120), '把这周 Cyber Hunter 的回访整理成一页', 2,
    [['note_search', '找这周的回访笔记', '5 篇'], ['note_read', '读回访记录', '读完了'],
      ['read_project', '读项目档案', 'Cyber Hunter']], null, 'visit');
  if (failed) {
    lines.change(MAIN_LINE_ID, { status: 'failed', outcome: 'failed', failure: '连不上模型，已重试 3 次' });
    return;
  }
  const until = new Date(now);
  until.setHours(21, 0, 0, 0);
  if (until.getTime() <= now.getTime()) {
    until.setDate(until.getDate() + 1);
  }
  lines.change(MAIN_LINE_ID, { status: 'paused', pauseReason: 'quota', pausedUntil: until.toISOString(),
    failure: '额度用完' });
}

/** 2026-11-05 设计稿 Task-Draft：跟 Plasticine 说一句，它起草了一张任务卡，以你的名义发出去前问你。 */
const DRAFT_ASK: AskSeed = { id: 'ask-line-card', kind: 'approve', basis: 'hard_line', lineId: MAIN_LINE_ID,
  question: '要把任务卡发给小林吗？',
  detail: ['发出后小林会收到', '硬线：以你的名义对外发出。只放行这一次、这组参数；改了参数要再问你。',
    '「send_task_card」的参数：' + JSON.stringify({ to: 'xiaolin', title: '帮我整理杭州周末适合带父母去的地方',
      goal: '每个写清怎么去、走多少路、几点去人少' })].join('\n'),
  taskCard: { to: { name: '小林', avatar: null, group: false }, assignee: null,
    title: '帮我整理杭州周末适合带父母去的地方', goal: '每个写清怎么去、走多少路、几点去人少', deadline: '周六前',
    attachment: '爸妈的情况.md' },
  options: [{ id: 'allow', label: '发出', recommended: true, description: null },
    { id: 'revise', label: '改一下', recommended: false, description: null },
    { id: 'deny', label: '先不', recommended: false, description: null }] };

function seedDraft(deps: LinesSeedDeps, now: Date): void {
  const { lines } = deps;
  const said = ago(now, 60);
  lines.record(MAIN_LINE_ID, message(said, { role: 'user', text: '让小林的 Plasticine 帮我整理杭州周末带父母去的地方，周六前' }));
  lines.record(MAIN_LINE_ID, message(new Date(said.getTime() + 3000), { thinking: '他要把这件事交给小林。',
    thinkingMs: 3000, steps: [], stopReason: 'toolUse' }));
  lines.change(MAIN_LINE_ID, { status: 'waiting', activity: null, activeSince: said.toISOString() });
  deps.raiseAsk(DRAFT_ASK);
}

export function seedLines(deps: LinesSeedDeps, now: Date, scene: LineScene): void {
  if (scene === 'chat') {
    seedChat(deps.lines, now);
    return;
  }
  if (scene === 'visa') {
    seedVisa(deps.lines, now);
    return;
  }
  seedBackground(deps, now);
  if (scene === 'draft') {
    seedDraft(deps, now);
    return;
  }
  if (scene === 'steps') {
    seedSteps(deps.lines, now);
  } else if (scene === 'waiting') {
    seedWaiting(deps, now);
  } else if (scene === 'paused' || scene === 'failed') {
    seedPaused(deps.lines, now, scene === 'failed');
  } else {
    seedWorking(deps.lines, now);
    seedBoltLine(deps, now);
  }
}
