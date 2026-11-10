// 一条线按消息 seq 排成对话。正文、过程与部件留在各自出现的位置，不能在结束时把过程移到已显示的文字上面。
// 子线卡用稳定的 child id 和发起消息定位；回报是后来的一条正文，更新卡的状态而不搬走或重建那张卡。

import type { LineMessageView, LineView } from '../../api/shared.ts';
import { spaceToolResult, type SpaceToolResult } from '../../../../agent/shared/space-result.ts';

/** 开后台线这一步由线卡片表示，不再在步骤里列一行。 */
const CARD_TOOLS: ReadonlySet<string> = new Set(['start_line']);
/** 步骤结果一句最多这么长：一行放得下，原文在工具结果里。 */
const RESULT_CHARS = 60;

export interface TurnStep {
  toolCallId: string;
  tool: string;
  say: string;
  /** 结果一句；还没结束是 null。 */
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
  /** 这一轮从第几条消息到第几条（在记录里找时按它滚过去）。 */
  firstSeq: number;
  lastSeq: number;
  /** 这一轮从哪条消息之后开始（他说的那句的时间），算「想了 n 秒」用。 */
  startedAt: string | null;
  parts: TurnPart[];
  thinking: string;
  thinkingSeconds: number | null;
  steps: TurnStep[];
  /**
   * 最后一条是工具结果、后面没有模型的话：这一轮半路断了（做某一步时被叫停，或服务重启）。服务端不记空的中止，
   * 线已经不在跑时按「停下了」画。
   */
  endedOnTool: boolean;
  /** 回答的几段（普通文字 / Markdown），按先后。 */
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
  | { kind: 'child'; key: string; line: LineView }
  /** 系统发在主线上的通知（《优化清单》第 12 条）：来源是系统，不是他说的、也不是 Plasticine 的回答。 */
  | { kind: 'notice'; key: string; message: LineMessageView }
  /** 建账号时服务端放的欢迎（11-08 设计稿 First-Main）：Plasticine 打招呼，下面几个「开始」。 */
  | { kind: 'welcome'; key: string; message: LineMessageView }
  /** 来信（第 8 批第 6 条，设计稿 Chat-Letter）：Plasticine 的一句话，下面一张来信卡。 */
  | { kind: 'letter'; key: string; message: LineMessageView }
  /** Plasticine 把话题挪到了一条旁聊（open_side_chat，第 17 条）：一行入口，点了过去。 */
  | { kind: 'side'; key: string; lineId: string; title: string; message: LineMessageView };

/** 开旁聊的那一步（服务端 lines/side-chats.ts 的 OPEN_SIDE_TOOL）。 */
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
    // 服务端记着想了多久（0063）就用它；旧消息没记，按他说那句到这条回答的时间估。
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

/** 旧线没有 seq 时按创建时间；同毫秒先放已出现的第一段助手说明，再放任务，避免越过发起它的文字。 */
function childAnchor(line: LineView, messages: readonly LineMessageView[]): number {
  if (line.parentMessageSeq !== null && line.parentMessageSeq !== undefined) return line.parentMessageSeq;
  const sameTime = messages.find((message) => message.role === 'assistant' && message.createdAt === line.createdAt);
  if (sameTime !== undefined) return sameTime.seq;
  return messages.findLast((message) => message.createdAt < line.createdAt)?.seq ?? 0;
}

function childrenByAnchor(input: TimelineInput): Map<number, LineView[]> {
  const anchors = new Map<number, LineView[]>();
  const children = input.lineId === null ? [] : input.lines.filter((line) => line.parentLineId === input.lineId)
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
}

/** 没内容的提醒：空白或字面上的 "null"。 */
export function blankNotice(text: string | null): boolean {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' || trimmed === 'null';
}

export function buildTimeline(input: TimelineInput): TimelineItem[] {
  const items: TimelineItem[] = [];
  const byId = new Map(input.lines.map((line) => [line.id, line]));
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
  appendChildren(0);
  for (const message of input.messages) {
    if (message.role === 'user') {
      turn = null;
      items.push({ kind: message.origin?.kind === 'user' ? 'user' : 'input', key: `m-${message.seq}`, message });
    } else if (message.role === 'notice') {
      // 修复前留下过一条正文是字符串 "null" 的提醒（11-08 17:02）：空的和 "null" 的不画，数据不动。
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
      turn = null;
      const line = message.childLineId === null ? null : byId.get(message.childLineId) ?? null;
      items.push({ kind: 'report', key: `m-${message.seq}`, message, line });
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
  return items;
}

/** 这一项占了哪几条消息（在记录里找时按它滚过去）；子线卡片不占。 */
export function seqRange(item: TimelineItem): [number, number] | null {
  if (item.kind === 'turn') return [item.firstSeq, item.lastSeq];
  if (item.kind === 'user' || item.kind === 'input' || item.kind === 'report') {
    return [item.message.seq, item.message.seq];
  }
  return null;
}

/** 最后一项是不是正在跑的这一轮（线在跑、最后不是他刚说的话）。 */
export function lastTurn(items: readonly TimelineItem[]): Turn | null {
  const last = items.at(-1);
  return last?.kind === 'turn' ? last : null;
}
