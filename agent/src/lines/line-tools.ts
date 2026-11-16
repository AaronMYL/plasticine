// 线的工具：开条线去做、看线列表、读一条线、给一条线插话；暂停、接着做、结束、归档 / 恢复、撤回排着的一句（11-16）。
// 「开条线去做」建一条后台线并开跑（同时在跑的后台线最多 3 条，多的排队）；它做完把最后那段话贴回发起它的线。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { LINE_STATUSES, LINE_TITLE_MAX_CHARS, type LineMessageView, type LineView,
  type QueuedMessageView } from '../../shared/api/lines.ts';
import { clip } from './messages.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';
import { accessibleLine, type LineAccessState } from './access.ts';

// 读一条线时默认带最近这么多条：够看清它做到哪了，不把整条线搬进上下文。
const READ_DEFAULT = 20;
const READ_MAX = 100;
const LIST_MAX = 50;
// 每条消息给模型看的长度。
const MESSAGE_CHARS = 2_000;

export interface LineControl {
  spawn(parentLineId: string, input: { title: string; goal: string; projectId: string | null;
    resumeParent?: boolean }, toolCallId?: string): LineView;
  list(filter: { statuses?: readonly LineView['status'][]; includeArchived?: boolean; limit: number }): LineView[];
  read(lineId: string, limit: number): { line: LineView; messages: LineMessageView[]; queue: QueuedMessageView[] };
  tell(lineId: string, text: string): { line: LineView; outcome: 'steered' | 'started' | 'queued' };
  halt(lineId: string): LineView;
  /** 11-16：任务收尾（Aaron 定「全部放开」）：接着做、结束、归档 / 恢复、撤回排着的一句。 */
  retry(lineId: string): LineView;
  end(lineId: string): LineView;
  archive(lineId: string): LineView;
  restore(lineId: string): LineView;
  withdraw(lineId: string, queueId: string): { line: LineView; item: QueuedMessageView };
}

const LineId = Type.String({ minLength: 1, description: 'The line id (from start_line or list_lines)' });

const StartParameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: LINE_TITLE_MAX_CHARS, description: 'Short Chinese title' }),
  goal: Type.String({ minLength: 1, maxLength: 8_000,
    description: 'What to do, complete enough to work alone: the question, what counts as done, what to report' }),
  projectId: Type.Optional(Type.String({ minLength: 1, description: 'The project this belongs to, if any' })),
  resumeParent: Type.Optional(Type.Boolean({
    description: 'Resume this line once the child finishes, only when its result needs synthesis or a next step' })),
}, { additionalProperties: false });

const ListParameters = Type.Object({
  status: Type.Optional(Type.Enum(LINE_STATUSES)),
  mateId: Type.Optional(Type.String({ minLength: 1, description: '只看这位队友的' })),
  parentLineId: Type.Optional(Type.String({ minLength: 1, description: '只看从这条线派出去的' })),
  includeArchived: Type.Optional(Type.Boolean({ description: '连归档了的一起列' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LIST_MAX })),
}, { additionalProperties: false });

const ArchiveParameters = Type.Object({
  lineId: LineId,
  restore: Type.Optional(Type.Boolean({ description: 'true：把归档了的恢复出来（恢复后是暂停，要接着做再 line_resume）' })),
}, { additionalProperties: false });

const WithdrawParameters = Type.Object({
  lineId: LineId,
  queueId: Type.String({ minLength: 1, description: 'read_line 结果 queue 里那一句的 id' }),
}, { additionalProperties: false });

const ReadParameters = Type.Object({
  lineId: LineId,
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: READ_MAX })),
}, { additionalProperties: false });

const TellParameters = Type.Object({
  lineId: LineId,
  text: Type.String({ minLength: 1, maxLength: 8_000 }),
}, { additionalProperties: false });

const StopParameters = Type.Object({ lineId: LineId }, { additionalProperties: false });

function brief(line: LineView): Record<string, unknown> {
  return { id: line.id, kind: line.kind, title: line.title, status: line.status, activity: line.activity,
    pauseReason: line.pauseReason, outcome: line.outcome,
    failure: line.failure, pausedUntil: line.pausedUntil, queued: line.queued, lastAnswer: line.lastAnswer,
    parentLineId: line.parentLineId, mateId: line.mateId ?? null, projectId: line.projectId,
    archivedAt: line.archivedAt ?? null, updatedAt: line.updatedAt };
}

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} };
}

function startTool(control: LineControl, scope: LineScope): AgentTool<typeof StartParameters> {
  return {
    name: 'start_line',
    label: '开条线去做',
    description: '开一条后台线去做一件要花时间的事（查资料、跑一串命令、等外面回话），主对话不用等。'
      + '后台线做完会把它最后那段话贴回这条线。goal 写完整：它看不到这里的对话。',
    parameters: StartParameters,
    async execute(toolCallId, raw) {
      const args = checkedArgs(StartParameters, raw, 'start_line');
      const line = control.spawn(scope.lineId, { title: args.title, goal: args.goal,
        projectId: args.projectId ?? scope.projectId, resumeParent: args.resumeParent ?? false }, toolCallId);
      return json({ started: brief(line), note: line.status === 'running' ? '已开跑' : '后台线已满 3 条，排队中' });
    },
  };
}

function listTool(control: LineControl): AgentTool<typeof ListParameters> {
  return {
    name: 'list_lines',
    label: '看线列表',
    description: '列出线（主对话和后台线）：状态、在做什么、结果预览。',
    parameters: ListParameters,
    replay: 'safe',
    async execute(_id, raw) {
      const args = checkedArgs(ListParameters, raw, 'list_lines');
      const filtered = args.mateId !== undefined || args.parentLineId !== undefined;
      const lines = control.list({ ...(args.status === undefined ? {} : { statuses: [args.status] }),
        includeArchived: args.includeArchived ?? false, limit: filtered ? LIST_MAX * 4 : args.limit ?? LIST_MAX })
        .filter((line) => (args.mateId === undefined || line.mateId === args.mateId)
          && (args.parentLineId === undefined || line.parentLineId === args.parentLineId))
        .slice(0, args.limit ?? LIST_MAX);
      return json({ lines: lines.map(brief) });
    },
  };
}

function readTool(control: LineControl): AgentTool<typeof ReadParameters> {
  return {
    name: 'read_line',
    label: '读一条线',
    description: '读一条线最近的消息（用户的话、回答、每一步做了什么），看它做到哪了。',
    parameters: ReadParameters,
    replay: 'safe',
    async execute(_id, raw) {
      const args = checkedArgs(ReadParameters, raw, 'read_line');
      const { line, messages, queue } = control.read(args.lineId, args.limit ?? READ_DEFAULT);
      return json({ line: brief(line), messages: messages.map((message) => ({ seq: message.seq, role: message.role,
        text: clip(message.text, MESSAGE_CHARS), origin: message.origin,
        steps: message.steps.map((step) => step.say), ok: message.ok })),
      queue: queue.map((item) => ({ id: item.id, text: clip(item.text, MESSAGE_CHARS), status: item.status,
        createdAt: item.createdAt })) });
    },
  };
}

function tellTool(control: LineControl): AgentTool<typeof TellParameters> {
  return {
    name: 'tell_line',
    label: '给一条线插话',
    description: '给一条线插一句话：它在跑就插进正在跑的这一轮，空着就开一轮。用来补充要求、纠正方向。',
    parameters: TellParameters,
    async execute(_id, raw) {
      const args = checkedArgs(TellParameters, raw, 'tell_line');
      const told = control.tell(args.lineId, args.text);
      return json({ outcome: told.outcome, line: brief(told.line) });
    },
  };
}

type LineVerb = 'line_pause' | 'line_resume' | 'line_end';

const VERBS: Readonly<Record<LineVerb, { label: string; description: string; run(control: LineControl, id: string)
  : LineView }>> = {
  line_pause: { label: '暂停一条线',
    description: '暂停一条线：正在跑的这一轮停下，进度和排着的话都留着，以后 line_resume 接着做。',
    run: (control, id) => control.halt(id) },
  line_resume: { label: '接着做一条线',
    description: '让暂停了或失败了的线从停下的地方接着做（排着的话照顺序发出）。他暂停的也可以：他又提起这件事、'
      + '或设备恢复了，就接着做原来那条，不要另开一条。停止了的不能再接着做。',
    run: (control, id) => control.retry(id) },
  line_end: { label: '结束一条线',
    description: '结束一条线：不再做，记录留着，排着的话撤回；结束了不能再接着做。重复的、作废的、已经由别的线做完的'
      + '任务用它收尾。主对话不能结束。',
    run: (control, id) => control.end(id) },
};

function verbTool(control: LineControl, name: LineVerb): AgentTool<typeof StopParameters> {
  const verb = VERBS[name];
  return {
    name,
    label: verb.label,
    description: verb.description,
    parameters: StopParameters,
    async execute(_id, raw) {
      const args = checkedArgs(StopParameters, raw, name);
      return json({ line: brief(verb.run(control, args.lineId)) });
    },
  };
}

function archiveTool(control: LineControl): AgentTool<typeof ArchiveParameters> {
  return {
    name: 'line_archive',
    label: '归档一条线',
    description: '把一条线收进最近删除（可恢复，不真删）：还在做的停下，排着的话撤回。restore: true 把它恢复出来。',
    parameters: ArchiveParameters,
    async execute(_id, raw) {
      const args = checkedArgs(ArchiveParameters, raw, 'line_archive');
      return json({ line: brief(args.restore === true ? control.restore(args.lineId) : control.archive(args.lineId)) });
    },
  };
}

function withdrawTool(control: LineControl): AgentTool<typeof WithdrawParameters> {
  return {
    name: 'line_queue_withdraw',
    label: '撤回排着的一句',
    description: '撤回一条线里还没发出的一句话（read_line 结果的 queue 里有 id）。已经被这一轮取走的撤不回。',
    parameters: WithdrawParameters,
    async execute(_id, raw) {
      const args = checkedArgs(WithdrawParameters, raw, 'line_queue_withdraw');
      const { line, item } = control.withdraw(args.lineId, args.queueId);
      return json({ line: brief(line), withdrawn: { id: item.id, status: item.status } });
    },
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function scopedControl(control: LineControl, state: LineAccessState, scope: LineScope): LineControl {
  const requireAccess = (id: string, mode: 'read' | 'control'): void => {
    if (!accessibleLine(state, scope, id, mode)) {
      throw new Error(mode === 'read' ? '只能读取自己的对话、交接结果和所属群组的公共对话。'
        : '只能给自己的对话和后台工作插话或叫停；跨队友协作请用 mate_handoff。');
    }
  };
  return {
    spawn: (...args) => control.spawn(...args),
    list: (filter) => {
      const source = state.lines.get(scope.lineId);
      if (source !== undefined && source.mateId == null) return control.list(filter);
      return control.list({ ...filter, limit: Number.MAX_SAFE_INTEGER })
        .filter((line) => accessibleLine(state, scope, line.id)).slice(0, filter.limit);
    },
    read: (id, limit) => {
      requireAccess(id, 'read');
      return control.read(id, limit);
    },
    tell: (id, text) => {
      requireAccess(id, 'control');
      return control.tell(id, text);
    },
    halt: (id) => {
      requireAccess(id, 'control');
      return control.halt(id);
    },
    retry: (id) => {
      requireAccess(id, 'control');
      return control.retry(id);
    },
    end: (id) => {
      requireAccess(id, 'control');
      return control.end(id);
    },
    archive: (id) => {
      requireAccess(id, 'control');
      return control.archive(id);
    },
    restore: (id) => {
      requireAccess(id, 'control');
      return control.restore(id);
    },
    withdraw: (id, queueId) => {
      requireAccess(id, 'control');
      return control.withdraw(id, queueId);
    },
  };
}

export function lineTools(control: LineControl, state: LineAccessState): KernelTool[] {
  return [
    { name: 'start_line', say: (args) => `开一条线：${text(args['title'])}`, hardLine: () => null,
      create: (scope) => startTool(control, scope) },
    { name: 'list_lines', say: () => '看线列表', hardLine: () => null,
      create: (scope) => listTool(scopedControl(control, state, scope)) },
    { name: 'read_line', say: () => '读一条线', hardLine: () => null,
      create: (scope) => readTool(scopedControl(control, state, scope)) },
    { name: 'tell_line', say: () => '给一条线插话', hardLine: () => null,
      create: (scope) => tellTool(scopedControl(control, state, scope)) },
    ...(Object.keys(VERBS) as LineVerb[]).map((name): KernelTool => ({ name, say: () => VERBS[name].label,
      hardLine: () => null, create: (scope) => verbTool(scopedControl(control, state, scope), name) })),
    { name: 'line_archive', say: (args) => (args['restore'] === true ? '恢复一条线' : '归档一条线'),
      hardLine: () => null, create: (scope) => archiveTool(scopedControl(control, state, scope)) },
    { name: 'line_queue_withdraw', say: () => '撤回排着的一句', hardLine: () => null,
      create: (scope) => withdrawTool(scopedControl(control, state, scope)) },
  ];
}
