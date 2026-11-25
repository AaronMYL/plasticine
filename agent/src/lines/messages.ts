import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, ImageContent, Message, TextContent, ToolResultMessage, UserMessage }
  from '@earendil-works/pi-ai';
import { Value } from 'typebox/value';
import type { LineMessageView, LineRelay } from '../../shared/api/lines.ts';
import type { WelcomeStart } from '../../shared/welcome-start.ts';
import { splitReply } from '../../shared/line-reply.ts';
import { MessageWidgetSchema, type MessageWidget } from '../../shared/api/message-widgets.ts';
import { spaceToolResult } from '../../shared/space-result.ts';
import type { LineMessageRow } from '../state/index.ts';

export type ReportOutcome = 'done' | 'failed' | 'paused';

export interface LineReportMessage {
  role: 'lineReport';
  lineId: string;
  title: string;
  outcome: ReportOutcome;
  text: string;
  timestamp: number;
  unmet?: string;
  relay?: LineRelay;
  own?: boolean;
}

export interface LineHandoffMessage {
  role: 'handoff';
  lineId: string;
  title: string;
  text: string;
  relay: LineRelay;
  timestamp: number;
}

export interface LineNoticeMessage {
  role: 'notice';
  key: string;
  text: string;
  brief: string;
  timestamp: number;
}

export interface LineWelcomeMessage {
  role: 'welcome';
  text: string;
  starts: WelcomeStart[];
  timestamp: number;
}

export interface LineLetterMessage {
  role: 'letter';
  key: string;
  text: string;
  spaceId: string;
  title: string;
  timestamp: number;
}

export type PostedMessage = LineReportMessage | LineNoticeMessage | LineWelcomeMessage | LineLetterMessage
  | LineHandoffMessage;

export interface LineSummaryMessage {
  role: 'lineSummary';
  summary: string;
  timestamp: number;
}

declare module '@earendil-works/pi-agent-core' {
  interface CustomAgentMessages {
    lineReport: LineReportMessage;
    lineSummary: LineSummaryMessage;
    notice: LineNoticeMessage;
    welcome: LineWelcomeMessage;
    letter: LineLetterMessage;
    handoff: LineHandoffMessage;
  }
}

export interface AttachmentNote {
  id: string;
  name: string;
}

const RESULT_PREVIEW_CHARS = 400;
const SUMMARY_CHARS = 120;

const ATTACHMENT_NOTE_START = '［附件：';
const ATTACHMENT_IDS = /；id：([^；］]*)；/;

export function userMessage(text: string, attachments: readonly AttachmentNote[], at: number): UserMessage {
  if (attachments.length === 0) {
    return { role: 'user', content: text, timestamp: at };
  }
  const names = attachments.map((item) => `「${item.name}」`).join('、');
  const ids = attachments.map((item) => item.id).join(', ');
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'text', text: `${ATTACHMENT_NOTE_START}${names}；id：${ids}；正文用 attachment_read 读］` },
    ],
    timestamp: at,
  };
}

export function attachmentIds(message: UserMessage): string[] {
  if (typeof message.content === 'string') {
    return [];
  }
  const note = message.content.find((part): part is TextContent => part.type === 'text'
    && part.text.startsWith(ATTACHMENT_NOTE_START));
  const ids = note === undefined ? undefined : ATTACHMENT_IDS.exec(note.text)?.[1];
  return ids === undefined ? [] : ids.split(',').map((id) => id.trim()).filter((id) => id !== '');
}

function userText(message: UserMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return contentText(message.content.filter((part) => part.type !== 'text'
    || !part.text.startsWith(ATTACHMENT_NOTE_START)));
}

const REPORT_HEADS: Readonly<Record<ReportOutcome, string>> = {
  done: '做完了，下面是它交回的结论（过程和技术细节留在那条线里，要看用 read_line）',
  failed: '没做完，下面是原因',
  paused: '暂停了，到点会自己接着做',
};

export function reportText(message: LineReportMessage): string {
  const ended = message.unmet === undefined ? REPORT_HEADS[message.outcome]
    : `跑完了但事没做成（${message.unmet}），下面是它交回的结论`;
  if (message.own === true) {
    return `［你在后台线「${message.title}」（${message.lineId}）里做的事${ended}，已经交回给交代你的那一方；`
      + `这不是用户说的］\n${message.text}`;
  }
  const head = `后台线「${message.title}」（${message.lineId}）${ended}`;
  const relay = message.relay === undefined ? ''
    : '；这是队友交回给你的，用户在你这里看不到原文，用你自己的话整理好再告诉他，别原样复述';
  return `［${head}${relay}；这不是用户说的］\n${message.text}`;
}

export function handoffText(message: LineHandoffMessage): string {
  const from = message.relay.from.kind === 'main' ? '主线' : '一位队友';
  return `［${from}交给你的话（事在后台线「${message.title}」（${message.lineId}）里做，过程在那条线里）；`
    + `这不是用户说的］\n${message.text}`;
}

export function noticeText(message: LineNoticeMessage): string {
  return `［系统通知；这不是用户说的，也不是你说的］\n${message.text}`;
}

export function welcomeText(message: LineWelcomeMessage): string {
  return `［Plasticine 发过一条欢迎（建账号时的固定文案，这不是用户说的）］\n${message.text}`;
}

export function letterText(message: LineLetterMessage): string {
  return `［你给他写了一封信《${message.title}》（空间 ${message.spaceId}），放进了资料库，在主线发了下面这一句；`
    + `这不是用户说的］\n${message.text}`;
}

export function summaryText(message: LineSummaryMessage): string {
  return `［这条线早先的内容已经压缩成下面的摘要；细节以摘要为准，需要原文时问用户或查记录］\n${message.summary}`;
}

export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.flatMap((message): Message[] => {
    if (message.role === 'lineReport') {
      return [{ role: 'user', content: reportText(message), timestamp: message.timestamp }];
    }
    if (message.role === 'lineSummary') {
      return [{ role: 'user', content: summaryText(message), timestamp: message.timestamp }];
    }
    if (message.role === 'notice') {
      return [{ role: 'user', content: noticeText(message), timestamp: message.timestamp }];
    }
    if (message.role === 'welcome') {
      return [{ role: 'user', content: welcomeText(message), timestamp: message.timestamp }];
    }
    if (message.role === 'letter') {
      return [{ role: 'user', content: letterText(message), timestamp: message.timestamp }];
    }
    if (message.role === 'handoff') {
      return [{ role: 'user', content: handoffText(message), timestamp: message.timestamp }];
    }
    return [message];
  });
}

export function contentText(content: string | readonly (TextContent | ImageContent | { type: string })[]): string {
  if (typeof content === 'string') {
    return content;
  }
  return content.flatMap((part) => (part.type === 'text' && 'text' in part ? [String(part.text)] : [])).join('\n');
}

export function answerText(message: AssistantMessage): string {
  return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n').trim();
}

function thinkingText(message: AssistantMessage): string | null {
  const text = message.content.flatMap((part) => (part.type === 'thinking' && part.redacted !== true
    ? [part.thinking] : [])).join('\n').trim();
  return text === '' ? null : text;
}

export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
}

export function resultSummary(result: { content?: readonly { type: string }[] } | undefined): string | null {
  const text = result?.content === undefined ? '' : contentText(result.content as TextContent[]);
  const first = text.split('\n').map((line) => line.trim()).find((line) => line !== '');
  return first === undefined ? null : clip(first, SUMMARY_CHARS);
}

export function isAssistant(message: unknown): message is AssistantMessage {
  return typeof message === 'object' && message !== null && Reflect.get(message, 'role') === 'assistant';
}

export function isToolResult(message: unknown): message is ToolResultMessage {
  return typeof message === 'object' && message !== null && Reflect.get(message, 'role') === 'toolResult';
}

export type SayOf = (tool: string, args: Record<string, unknown>) => string;

type ViewFields = Omit<LineMessageView, 'lineId' | 'seq' | 'createdAt' | 'role'>;

function emptyView(): ViewFields {
  return { text: '', origin: null, thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null,
    say: null, ok: null, summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
    reactions: [], replyTo: null };
}

function widgetsOf(details: unknown): MessageWidget[] {
  const widgets: unknown = typeof details === 'object' && details !== null ? Reflect.get(details, 'widgets')
    : undefined;
  return Array.isArray(widgets) ? widgets.filter((widget): widget is MessageWidget =>
    Value.Check(MessageWidgetSchema, widget)) : [];
}

function childOf(details: unknown): string | null {
  const id: unknown = typeof details === 'object' && details !== null ? Reflect.get(details, 'childLineId')
    : undefined;
  return typeof id === 'string' && id !== '' ? id : null;
}

export function messageView(row: LineMessageRow, sayOf: SayOf, callArgs?: (toolCallId: string) => unknown)
  : LineMessageView {
  const base = { lineId: row.lineId, seq: row.seq, createdAt: row.createdAt };
  const message = row.message as AgentMessage;
  const reactions = row.meta?.reactions ?? [];
  const view = (fields: Partial<ViewFields> & { role: LineMessageView['role'] }): LineMessageView => ({ ...base,
    ...emptyView(), reactions, ...fields });
  if (message.role === 'user') {
    const said = splitReply(userText(message));
    return view({ role: 'user', origin: row.meta?.origin ?? { kind: 'unknown' }, text: said.text,
      replyTo: said.replyTo, attachments: attachmentIds(message) });
  }
  if (message.role === 'assistant') {
    const steps = message.content.flatMap((part) => (part.type === 'toolCall'
      ? [{ toolCallId: part.id, tool: part.name, say: sayOf(part.name, part.arguments) }] : []));
    return view({ role: 'assistant', text: answerText(message), thinking: thinkingText(message),
      thinkingMs: row.meta?.thinkingMs ?? null, steps, stopReason: message.stopReason });
  }
  if (message.role === 'toolResult') {
    const args = callArgs?.(message.toolCallId);
    const say = typeof args === 'object' && args !== null ? sayOf(message.toolName, args as Record<string, unknown>)
      : sayOf(message.toolName, {});
    const raw = contentText(message.content);
    const space = message.isError ? null : spaceToolResult(message.toolName, raw);
    const text = space === null ? clip(raw, RESULT_PREVIEW_CHARS) : JSON.stringify(space);
    return view({ role: 'toolResult', text, toolCallId: message.toolCallId, tool: message.toolName, say,
      ok: !message.isError, summary: row.meta?.summary ?? null, widgets: widgetsOf(message.details),
      childLineId: childOf(message.details) });
  }
  if (message.role === 'lineReport') {
    const unmet = message.unmet !== undefined;
    return view({ role: 'lineReport', text: message.text, ok: message.outcome === 'done' && !unmet,
      stopReason: unmet ? 'unmet' : message.outcome, childLineId: message.lineId,
      ...(message.relay === undefined ? {} : { relay: message.relay }) });
  }
  if (message.role === 'handoff') {
    return view({ role: 'handoff', text: message.text, childLineId: message.lineId, relay: message.relay });
  }
  if (message.role === 'lineSummary') {
    return view({ role: 'lineSummary', text: message.summary });
  }
  if (message.role === 'notice') {
    return view({ role: 'notice', origin: { kind: 'system' }, text: message.text, summary: message.brief });
  }
  if (message.role === 'welcome') {
    return view({ role: 'welcome', text: message.text, starts: message.starts });
  }
  if (message.role === 'letter') {
    return view({ role: 'letter', text: message.text, letter: { spaceId: message.spaceId, title: message.title } });
  }
  return view({ role: 'user', origin: { kind: 'unknown' }, text: '' });
}
