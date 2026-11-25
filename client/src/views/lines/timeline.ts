import type { LineMessageView, LineView } from '../../api/shared.ts';
import type { PlacedAsk } from '../asks/conversation-asks.ts';
import { spaceToolResult, type SpaceToolResult } from '../../../../agent/shared/space-result.ts';

const CARD_TOOLS: ReadonlySet<string> = new Set(['start_line']);
const RESULT_CHARS = 60;

export interface TurnStep {
  toolCallId: string;
  tool: string;
  say: string;
  result: string | null;
  ok: boolean | null;
}

export type TurnPart =
  | { kind: 'space'; seq: number; result: SpaceToolResult }
  | { kind: 'answer'; seq: number; text: string; attachments?: string[] }
  | { kind: 'thinking'; seq: number; text: string; seconds: number | null }
  | { kind: 'steps'; seq: number; steps: TurnStep[] }
  | { kind: 'widgets'; seq: number; widgets: LineMessageView['widgets'] }
  | { kind: 'error'; seq: number; text: string }
  | { kind: 'stopped'; seq: number };

export interface Turn {
  kind: 'turn';
  key: string;
  firstSeq: number;
  lastSeq: number;
  startedAt: string | null;
  parts: TurnPart[];
  thinking: string;
  thinkingSeconds: number | null;
  steps: TurnStep[];
  endedOnTool: boolean;
  answers: string[];
  error: string | null;
  stopped: boolean;
  widgets: LineMessageView['widgets'];
}

export type TimelineItem =
  | { kind: 'user'; key: string; message: LineMessageView }
  | { kind: 'input'; key: string; message: LineMessageView }
  | Turn
  | { kind: 'report'; key: string; message: LineMessageView; line: LineView | null }
  | { kind: 'handoff'; key: string; message: LineMessageView; line: LineView | null }
  | { kind: 'child'; key: string; line: LineView }
  | { kind: 'notice'; key: string; message: LineMessageView }
  | { kind: 'welcome'; key: string; message: LineMessageView }
  | { kind: 'letter'; key: string; message: LineMessageView }
  | { kind: 'side'; key: string; lineId: string; title: string; message: LineMessageView }
  | { kind: 'ask'; key: string; placed: PlacedAsk };

const SIDE_TOOL = 'open_side_chat';

export function clipResult(text: string): string {
  const first = text.split('\n').map((part) => part.trim()).find((part) => part !== '') ?? '';
  return first.length > RESULT_CHARS ? `${first.slice(0, RESULT_CHARS - 1)}…` : first;
}

function secondsBetween(from: string | null, to: string): number | null {
  if (from === null) {
    return null;
  }
  const seconds = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, seconds) : null;
}

function emptyTurn(seq: number, startedAt: string | null): Turn {
  return { kind: 'turn', key: `t-${seq}`, firstSeq: seq, lastSeq: seq, startedAt, thinking: '', thinkingSeconds: null,
    parts: [], steps: [], answers: [], error: null, stopped: false, widgets: [], endedOnTool: false };
}

function addAssistant(turn: Turn, message: LineMessageView): void {
  if (message.stopReason !== 'error' && (message.text.trim() !== '' || message.attachments.length > 0)) {
    turn.answers.push(message.text);
    turn.parts.push({ kind: 'answer', seq: message.seq, text: message.text,
      ...(message.attachments.length === 0 ? {} : { attachments: message.attachments }) });
  }
  if (message.thinking !== null && message.thinking.trim() !== '') {
    turn.thinking = turn.thinking === '' ? message.thinking : `${turn.thinking}\n\n${message.thinking}`;
    const seconds = message.thinkingMs === null ? secondsBetween(turn.startedAt, message.createdAt)
      : Math.max(1, Math.round(message.thinkingMs / 1000));
    turn.thinkingSeconds ??= seconds;
    turn.parts.push({ kind: 'thinking', seq: message.seq, text: message.thinking, seconds });
  }
  const steps = message.steps.filter((step) => !CARD_TOOLS.has(step.tool))
    .map((step): TurnStep => ({ ...step, result: null, ok: null }));
  if (steps.length > 0) {
    turn.steps.push(...steps);
    const previous = turn.parts.at(-1);
    if (previous?.kind === 'steps') previous.steps.push(...steps);
    else turn.parts.push({ kind: 'steps', seq: message.seq, steps });
  }
  addWidgets(turn, message);
  if (message.stopReason === 'error') {
    turn.error = message.text.trim() === '' ? '连不上模型' : message.text.trim();
    turn.parts.push({ kind: 'error', seq: message.seq, text: turn.error });
  } else if (message.stopReason === 'aborted') {
    turn.stopped = true;
    turn.parts.push({ kind: 'stopped', seq: message.seq });
  }
}

function addWidgets(turn: Turn, message: LineMessageView): void {
  if (message.widgets.length > 0) {
    turn.widgets.push(...message.widgets);
    turn.parts.push({ kind: 'widgets', seq: message.seq, widgets: message.widgets });
  }
}

function childAnchor(line: LineView, messages: readonly LineMessageView[]): number {
  if (line.parentMessageSeq !== null && line.parentMessageSeq !== undefined) return line.parentMessageSeq;
  const sameTime = messages.find((message) => message.role === 'assistant' && message.createdAt === line.createdAt);
  if (sameTime !== undefined) return sameTime.seq;
  return messages.findLast((message) => message.createdAt < line.createdAt)?.seq ?? 0;
}

function handedAway(current: LineView | undefined, child: LineView | undefined): boolean {
  return current !== undefined && child?.handedOff === true && child.parentLineId === current.id;
}

function childrenByAnchor(input: TimelineInput): Map<number, LineView[]> {
  const anchors = new Map<number, LineView[]>();
  const current = input.lines.find((line) => line.id === input.lineId);
  const children = input.lineId === null ? [] : input.lines.filter((line) => line.parentLineId === input.lineId
    && !handedAway(current, line))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const line of children) {
    const anchor = childAnchor(line, input.messages);
    if (anchor > (input.messages.at(-1)?.seq ?? 0)) continue;
    const after = input.messages.findLast((message) => message.seq <= anchor)?.seq ?? 0;
    anchors.set(after, [...(anchors.get(after) ?? []), line]);
  }
  return anchors;
}

export interface TimelineInput {
  lineId: string | null;
  messages: readonly LineMessageView[];
  lines: readonly LineView[];
  summaries: ReadonlyMap<string, string>;
  asks?: readonly PlacedAsk[];
}

export function blankNotice(text: string | null): boolean {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' || trimmed === 'null';
}

export function buildTimeline(input: TimelineInput): TimelineItem[] {
  const items: TimelineItem[] = [];
  const byId = new Map(input.lines.map((line) => [line.id, line]));
  const current = input.lineId === null ? undefined : byId.get(input.lineId);
  const children = childrenByAnchor(input);
  const steps = new Map<string, TurnStep>();
  let turn: Turn | null = null;
  let lastAt: string | null = null;
  const appendChildren = (seq: number): void => {
    for (const line of children.get(seq) ?? []) {
      turn = null;
      items.push({ kind: 'child', key: `child-${line.id}`, line });
    }
  };
  const asks = [...(input.asks ?? [])];
  const appendAsks = (until: string | null): void => {
    while (asks[0] !== undefined && (until === null || asks[0].ask.createdAt < until)) {
      const placed = asks[0];
      asks.shift();
      turn = null;
      items.push({ kind: 'ask', key: `ask-${placed.ask.id}`, placed });
    }
  };
  appendChildren(0);
  for (const message of input.messages) {
    appendAsks(message.createdAt);
    if (message.role === 'user') {
      turn = null;
      items.push({ kind: message.origin?.kind === 'user' ? 'user' : 'input', key: `m-${message.seq}`, message });
    } else if (message.role === 'notice') {
      if (!blankNotice(message.text)) {
        turn = null;
        items.push({ kind: 'notice', key: `m-${message.seq}`, message });
      }
    } else if (message.role === 'welcome') {
      turn = null;
      items.push({ kind: 'welcome', key: `m-${message.seq}`, message });
    } else if (message.role === 'letter') {
      turn = null;
      items.push({ kind: 'letter', key: `m-${message.seq}`, message });
    } else if (message.role === 'lineReport') {
      const line = message.childLineId === null ? null : byId.get(message.childLineId) ?? null;
      const relayed = message.relay?.from.kind === 'mate' && current !== undefined && current.mateGroupId == null
        && current.mateId !== message.relay.from.id;
      if (!handedAway(current, line ?? undefined) && !relayed) {
        turn = null;
        items.push({ kind: 'report', key: `m-${message.seq}`, message, line });
      }
    } else if (message.role === 'handoff') {
      turn = null;
      const line = message.childLineId === null ? null : byId.get(message.childLineId) ?? null;
      items.push({ kind: 'handoff', key: `m-${message.seq}`, message, line });
    } else if (message.role === 'assistant' || (message.role === 'toolResult'
      && (message.widgets.length > 0 || (message.ok && spaceToolResult(message.tool, message.text) !== null)))) {
      if (turn === null) {
        turn = emptyTurn(message.seq, lastAt);
        items.push(turn);
      }
      turn.lastSeq = message.seq;
      if (message.role === 'assistant') {
        addAssistant(turn, message);
        for (const step of turn.steps) steps.set(step.toolCallId, step);
      } else {
        addWidgets(turn, message);
        const result = message.ok ? spaceToolResult(message.tool, message.text) : null;
        if (result !== null) turn.parts.push({ kind: 'space', seq: message.seq, result });
      }
      turn.endedOnTool = message.role === 'toolResult';
    }
    if (message.role === 'toolResult' && message.tool === SIDE_TOOL && message.childLineId !== null) {
      const side = byId.get(message.childLineId);
      turn = null;
      items.push({ kind: 'side', key: `side-${message.seq}`, lineId: message.childLineId, message,
        title: side?.title ?? message.say?.replace(/^挪到旁聊：/, '') ?? '对话' });
    }
    if (message.role === 'toolResult') {
      const id = message.toolCallId;
      const step = id === null ? undefined : steps.get(id);
      if (step !== undefined && id !== null) {
        step.result = input.summaries.get(id) ?? message.summary ?? clipResult(message.text);
        step.ok = message.ok;
      }
      if (turn !== null) {
        turn.lastSeq = message.seq;
        turn.endedOnTool = true;
      }
    }
    lastAt = message.createdAt;
    appendChildren(message.seq);
  }
  appendAsks(null);
  return items;
}

export function seqRange(item: TimelineItem): [number, number] | null {
  if (item.kind === 'turn') return [item.firstSeq, item.lastSeq];
  if (item.kind === 'user' || item.kind === 'input' || item.kind === 'report' || item.kind === 'handoff') {
    return [item.message.seq, item.message.seq];
  }
  return null;
}

export function lastTurn(items: readonly TimelineItem[]): Turn | null {
  const last = items.at(-1);
  return last?.kind === 'turn' ? last : null;
}
