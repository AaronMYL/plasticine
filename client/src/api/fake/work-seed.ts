// 已确认工作详情的真实客户端截图场景：?work=running / paused / quota / partial / done / revision …
// 每个状态都有对应消息、来源或卡片；不是只换标题的静态页面。

import type { LineMessageView, LineView, NetworkTaskView } from '../shared.ts';
import { ApiError } from '../errors.ts';
import type { FakeAsks } from './fake-asks.ts';
import { nextTask, type FakeContacts } from './fake-contacts.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';

const SCENES = ['home', 'queued', 'running', 'waiting', 'paused', 'quota', 'partial', 'done', 'failed',
  'revision', 'empty', 'loading', 'error'] as const;
export type WorkScene = typeof SCENES[number];

export function workSceneOf(search: string): WorkScene | null {
  const value = new URLSearchParams(search).get('work');
  return SCENES.find((scene) => scene === value) ?? null;
}

export interface WorkSeedDeps {
  lines: FakeLines;
  asks: FakeAsks;
  contacts: FakeContacts;
  projectId: string | null;
}

const TITLE = '查 CuaDriver 的安装来源';
const REQUEST = '来源这个慢慢查，查完告诉我。顺便看看还有没有别的 Cua 组件。';
const RESULT = 'CuaDriver 是随 **Cua** 一起安装的，不是另一家软件单独装的。\n\n'
  + '- 应用签名是 Cua AI, Inc.，苹果公证有效。\n'
  + '- 安装记录与 Cua 首次运行的时间相同。\n'
  + '- 登录项和常见组件目录中，没有找到别的 Cua 组件。\n\n'
  + '安装来源与现有记录一致。之后如果要停用，先在系统设置里关闭辅助功能和屏幕录制权限。';

function message(now: Date, fields: Partial<LineMessageView>): Omit<LineMessageView, 'lineId' | 'seq'> {
  return { role: 'assistant', text: '', origin: null, thinking: null, thinkingMs: null, steps: [], toolCallId: null,
    tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
    createdAt: now.toISOString(), ...fields };
}

function fields(scene: WorkScene, now: Date): Partial<LineView> {
  const running = { status: 'running' as const, activeSince: new Date(now.getTime() - 134_000).toISOString(),
    activity: '在 Mac 上读安装记录…' };
  switch (scene) {
    case 'queued': return { status: 'queued' };
    case 'waiting': return { status: 'waiting' };
    case 'paused': return { status: 'paused', pauseReason: 'user', outcome: 'stopped' };
    case 'quota': return { status: 'paused', pauseReason: 'quota', pausedUntil:
      new Date(now.getTime() + 3_600_000).toISOString(), failure: '额度用完' };
    case 'partial': return { status: 'paused', pauseReason: 'output_limit', outcome: 'incomplete' };
    case 'failed': return { status: 'failed', outcome: 'failed', failure: '连不上模型，已重试 3 次' };
    case 'done':
    case 'revision': return { status: 'idle', outcome: 'done', lastAnswer: RESULT.slice(0, 120) };
    default: return running;
  }
}

/** 测试也使用这个空意见返工夹具：答卡后沿同一条线继续，或者本人接手；没有自动空转。 */
export function seedWorkRevision(deps: WorkSeedDeps, now: Date): NetworkTaskView {
  const { contacts, asks, lines } = deps;
  contacts.addPerson({ id: 'work-xiaolin', name: '小林', handle: 'xiaolin', relation: 'friend' });
  const task: NetworkTaskView = { id: 'work-task', direction: 'in', contactId: 'work-xiaolin', title: TITLE,
    goal: REQUEST, acceptance: '确认来源，列出核对依据。', deadline: null, state: 'rejected', doer: 'ai', stage: 4,
    waiting: true, delivery: { text: RESULT, at: now.toISOString() },
    verdict: { verdict: 'reject', note: '', at: now.toISOString() }, localTaskId: 'line-work',
    revisionAskId: 'work-revision', createdAt: now.toISOString(), updatedAt: now.toISOString(), version: 1 };
  contacts.seedTask(task);
  asks.raise({ id: 'work-revision', kind: 'decide', channel: 'next_report', networkTaskId: task.id,
    question: '小林请再改改：查 CuaDriver 的安装来源', detail: '对方没有说明要怎么改。', options: [
      { id: 'by_ai', label: '让 Plasticine 继续', recommended: true, description: null },
      { id: 'by_person', label: '我来处理', recommended: false, description: null },
    ] });
  asks.onAnswer('work-revision', (option, text) => {
    const current = contacts.task(task.id);
    if (option === 'by_ai') {
      if (!text?.trim()) throw new Error('先补充修改意见');
      contacts.putTask(nextTask(current, { state: 'in_progress', revisionAskId: null, waiting: false }, now));
      lines.record('line-work', message(now, { role: 'user', text: `修改意见：${text}` }), { kind: 'network' });
      lines.change('line-work', { status: 'running', outcome: null, activeSince: now.toISOString(),
        activity: '按修改意见重新核对…' });
    } else {
      lines.change('line-work', { status: 'paused', pauseReason: 'user', outcome: 'stopped' });
      contacts.putTask(nextTask(current, { doer: 'person', revisionAskId: null }, now));
    }
  });
  return task;
}

export function seedWorkScene(deps: WorkSeedDeps, now: Date, scene: WorkScene): void {
  const { lines, asks } = deps;
  if (scene === 'empty') return;
  const source = lines.record(MAIN_LINE_ID, message(now, { role: 'user', text: REQUEST }),
    { kind: 'user', userText: REQUEST });
  if (deps.projectId !== null) lines.seedProject(deps.projectId, 'Cyber Hunter');
  lines.put(lines.blank('line-work', 'background', TITLE, { projectId: deps.projectId, ...fields(scene, now) }));
  lines.record('line-work', message(now, { role: 'user', text: REQUEST }),
    { kind: 'delegation', ref: `line:${MAIN_LINE_ID}:${source.seq}` });
  const steps = [
    ['signature', '验证应用签名', '签名有效，苹果公证通过'],
    ['install', '核对安装记录', '与 Cua 首次运行的时间相同'],
    ['components', '查找其他组件', '登录项里没有其他 Cua 组件'],
  ];
  lines.record('line-work', message(now, { stopReason: 'toolUse',
    steps: steps.map(([id, say]) => ({ toolCallId: id!, tool: 'device_action', say: say! })) }));
  for (const [id, say, text] of steps) {
    lines.record('line-work', message(now, { role: 'toolResult', tool: 'device_action', toolCallId: id!,
      say: say!, text: text!, ok: true, summary: text! }));
  }
  if (scene === 'done' || scene === 'revision') {
    const previous = new Date(now.getTime() - 86_400_000);
    lines.record('line-work', message(previous, { text: '已找到应用签名，安装时间还需要核对。',
      stopReason: 'stop' }));
    const revision = '把安装时间和核对依据也补进去。';
    lines.record('line-work', message(now, { role: 'user', text: revision }), { kind: 'user', userText: revision });
  }
  if (scene === 'done' || scene === 'revision' || scene === 'partial') {
    lines.record('line-work', message(now, { text: scene === 'partial' ? RESULT.slice(0, 140) : RESULT,
      stopReason: scene === 'partial' ? 'length' : 'stop' }));
  }
  if (scene === 'paused') lines.seedQueued('line-work', '先确认安装记录里的日期，再给我结论。');
  if (scene === 'waiting') asks.raise({ id: 'work-ask', kind: 'decide', channel: 'next_report', lineId: 'line-work',
    question: '要把这份核对结果写进笔记吗？', options: [
      { id: 'yes', label: '写进笔记', recommended: true, description: null },
      { id: 'no', label: '先不用', recommended: false, description: null },
    ] });
  if (scene === 'revision') seedWorkRevision(deps, now);
  if (scene === 'home' || scene === 'error' || scene === 'loading') {
    lines.put(lines.blank('line-result', 'background', '杭州周末带父母去的三个地方', {
      outcome: 'done', lastAnswer: '三条路线已整理', updatedAt: new Date(now.getTime() - 1_200_000).toISOString(),
    }));
    lines.record('line-result', message(now, { role: 'user', text: '整理三条适合父母的路线' }), { kind: 'delegation' });
    lines.record('line-result', message(now, { text: '人民公园、杜甫草堂、望江楼公园。\n\n交通与步行距离已核对。',
      stopReason: 'stop' }));
    // 跑完了但没做成（走查 11-07）：叉 + 一句原因。
    lines.put(lines.blank('line-unmet', 'background', '设置每日抖音续火花任务', {
      parentLineId: MAIN_LINE_ID, outcome: 'done', unmet: '当时还不能新建定时任务',
      lastAnswer: '这项定时任务还没建成，也没有发出任何消息。',
      createdAt: new Date(now.getTime() - 86_520_000).toISOString(),
      updatedAt: new Date(now.getTime() - 86_400_000).toISOString(),
    }));
    lines.put(lines.blank('line-waiting', 'background', '回 Bolt 的账单邮件', { status: 'waiting' }));
    asks.raise({ id: 'work-home-ask', kind: 'approve', basis: 'hard_line', channel: 'next_report',
      lineId: 'line-waiting', question: '要把回复发给 Bolt 吗？', detail: '发出后对方会收到，撤不回。', options: [
        { id: 'allow', label: '发出', recommended: true, description: null },
        { id: 'deny', label: '先不', recommended: false, description: null },
      ] });
  }
  if (scene === 'loading') lines.list = () => new Promise(() => undefined);
  if (scene === 'error') {
    // 列表服务持续失败，已经从事件流读到的结果仍在；恢复成功另由可控故障的行为测试核对。
    lines.list = async () => {
      await Promise.resolve();
      for (const line of lines.all()) lines.put(line);
      throw new ApiError({ kind: 'failed', code: 'offline', status: 503, message: '暂时连不上服务' });
    };
  }
}
