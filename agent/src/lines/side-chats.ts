import { BLANK_SIDE_TITLE, LINE_TITLE_MAX_CHARS, type ChatsResponse, type LineTopic,
  type LineView } from '../../shared/api/lines.ts';
import { replyExcerpt, splitReply, type LineReply } from '../../shared/line-reply.ts';
import { lineRef, type LineRow, type StateService } from '../state/index.ts';
import { LineError } from './kernel-types.ts';
import { clip } from './messages.ts';

export const OPEN_SIDE_TOOL = 'open_side_chat';
export const SIDES_LIMIT = 50;
const STATUS_CHARS = 40;

export type SideState = Pick<StateService, 'lines' | 'lineMessages'>;

export function titleFromText(text: string): string {
  const first = splitReply(text).text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
  return first === '' ? BLANK_SIDE_TITLE : clip(first, LINE_TITLE_MAX_CHARS - 1);
}

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

export function toggleReaction(state: SideState, lineId: string, seq: number, emoji: string, on: boolean): void {
  const row = state.lineMessages.get(lineId, seq);
  if (row === undefined) {
    throw new LineError('not_found', '这条消息已经不在了。');
  }
  const current = row.meta?.reactions ?? [];
  const next = on ? [...current.filter((item) => item !== emoji), emoji] : current.filter((item) => item !== emoji);
  state.lineMessages.patchMeta(lineId, seq, { reactions: next });
}

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

export function retitled(line: LineRow, text: string): string | null {
  return line.kind === 'side' && line.title === BLANK_SIDE_TITLE ? titleFromText(text) : null;
}
