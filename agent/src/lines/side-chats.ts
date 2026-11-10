// 旁聊（《优化清单》第 17 条，11-06 定）：他自己开一条把话题拎出去；主线话题岔开时 Plasticine 提议「挪到旁聊」
// （open_side_chat）；信息流条目点「讨论」开一条围绕那一条的。旁聊和主线同一套（按天分段、记忆库兜底、能翻原话、
// 活交给子代理），模型用途是 side。这里还有第二栏的列表（主线置顶 + 最新一行状态、旁聊列表）、表情和「回复某一条」。

import { BLANK_SIDE_TITLE, LINE_TITLE_MAX_CHARS, type ChatsResponse, type LineTopic,
  type LineView } from '../../shared/api/lines.ts';
import { replyExcerpt, splitReply, type LineReply } from '../../shared/line-reply.ts';
import type { LineRow, StateService } from '../state/index.ts';
import { lineRef } from '../state/index.ts';
import { LineError } from './kernel-types.ts';
import { clip } from './messages.ts';

export const OPEN_SIDE_TOOL = 'open_side_chat';
// 第二栏的旁聊最多列这么多（更早的在归档里）。
export const SIDES_LIMIT = 50;
// 主线那一行状态最多这么长：第二栏一行。
const STATUS_CHARS = 40;

export type SideState = Pick<StateService, 'lines' | 'lineMessages'>;

/** 空白旁聊发出第一句后用它起标题：第一行，截到标题上限。 */
export function titleFromText(text: string): string {
  const first = splitReply(text).text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
  return first === '' ? BLANK_SIDE_TITLE : clip(first, LINE_TITLE_MAX_CHARS - 1);
}

/** 他回复的那一条：作者和开头。只能回这条线里他说的、Plasticine 说的、贴回的结论。 */
export function replyFor(state: SideState, lineId: string, seq: number): LineReply {
  const said = state.lineMessages.said(lineRef(lineId, seq));
  if (said === undefined || !['user', 'assistant', 'lineReport'].includes(said.role)) {
    throw new LineError('invalid', '要回复的那一条不在这条线上了。', '刷新后再回复。');
  }
  const text = said.role === 'lineReport' ? reportText(state, lineId, seq) : splitReply(said.text).text;
  if (text.trim() === '') {
    throw new LineError('invalid', '那一条没有字，回复不了。');
  }
  return { seq, author: said.role === 'user' ? '你' : 'Plasticine', text: replyExcerpt(text) };
}

function reportText(state: SideState, lineId: string, seq: number): string {
  const message = state.lineMessages.get(lineId, seq)?.message;
  const text: unknown = typeof message === 'object' && message !== null ? Reflect.get(message, 'text') : undefined;
  return typeof text === 'string' ? text : '';
}

/** 表情：加上或拿掉，顺序按加的先后。 */
export function toggleReaction(state: SideState, lineId: string, seq: number, emoji: string, on: boolean): void {
  const row = state.lineMessages.get(lineId, seq);
  if (row === undefined) {
    throw new LineError('not_found', '这条消息已经不在了。');
  }
  const current = row.meta?.reactions ?? [];
  const next = on ? [...current.filter((item) => item !== emoji), emoji] : current.filter((item) => item !== emoji);
  state.lineMessages.patchMeta(lineId, seq, { reactions: next });
}

/**
 * 主线那一行状态：主线在做就是它在做的那一步；不然是最近在跑的后台线「标题 · 在做什么」；都没有就是主线最后那句回答的开头。
 */
export function mainStatus(main: LineView, background: readonly LineView[]): string | null {
  if (main.status === 'running' && main.activity !== null) {
    return clip(main.activity, STATUS_CHARS);
  }
  const working = background.find((line) => line.status === 'running');
  if (working !== undefined) {
    const doing = working.activity?.replace(/…$/, '') ?? '';
    return clip(doing === '' ? `${working.title}在做` : `${working.title} · ${doing}`, STATUS_CHARS);
  }
  return main.lastAnswer === null ? null : clip(main.lastAnswer.split('\n')[0] ?? '', STATUS_CHARS);
}

export function chats(main: LineView, background: readonly LineView[], sides: readonly LineView[]): ChatsResponse {
  return { main: { line: main, status: mainStatus(main, background) }, sides: [...sides] };
}

export interface SideControl {
  openSide(input: { title: string; topic: LineTopic | null }): LineView;
}

/** 空白的旁聊（标题还是「新旁聊」）发出第一句后换标题。 */
export function retitled(line: LineRow, text: string): string | null {
  return line.kind === 'side' && line.title === BLANK_SIDE_TITLE ? titleFromText(text) : null;
}
