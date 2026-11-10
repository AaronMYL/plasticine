// 线的工具：开条线去做、看线列表、读一条线、给一条线插话、停一条线。
// 「开条线去做」建一条后台线并开跑（同时在跑的后台线最多 3 条，多的排队）；它做完把最后那段话贴回发起它的线。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { LINE_STATUSES, LINE_TITLE_MAX_CHARS, type LineMessageView, type LineView } from '../../shared/api/lines.ts';
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
  list(filter: { statuses?: readonly LineView['status'][]; limit: number }): LineView[];
  read(lineId: string, limit: number): { line: LineView; messages: LineMessageView[] };
  tell(lineId: string, text: string): { line: LineView; outcome: 'steered' | 'started' | 'queued' };
  halt(lineId: string): LineView;
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
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LIST_MAX })),
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
    parentLineId: line.parentLineId, projectId: line.projectId, updatedAt: line.updatedAt };
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
      const lines = control.list({ ...(args.status === undefined ? {} : { statuses: [args.status] }),
        limit: args.limit ?? LIST_MAX });
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
      const { line, messages } = control.read(args.lineId, args.limit ?? READ_DEFAULT);
      return json({ line: brief(line), messages: messages.map((message) => ({ seq: message.seq, role: message.role,
        text: clip(message.text, MESSAGE_CHARS), origin: message.origin,
        steps: message.steps.map((step) => step.say), ok: message.ok })) });
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

function stopTool(control: LineControl): AgentTool<typeof StopParameters> {
  return {
    name: 'stop_line',
    label: '停一条线',
    description: '叫停一条线正在跑的这一轮（排队的消息留着）。',
    parameters: StopParameters,
    async execute(_id, raw) {
      const args = checkedArgs(StopParameters, raw, 'stop_line');
      return json({ stopped: brief(control.halt(args.lineId)) });
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
    read: (id, limit) => { requireAccess(id, 'read'); return control.read(id, limit); },
    tell: (id, text) => { requireAccess(id, 'control'); return control.tell(id, text); },
    halt: (id) => { requireAccess(id, 'control'); return control.halt(id); },
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
    { name: 'stop_line', say: () => '停一条线', hardLine: () => null,
      create: (scope) => stopTool(scopedControl(control, state, scope)) },
  ];
}
