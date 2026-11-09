// 线里的消息：pi 的消息原样存库；本内核自己加两种消息（后台线贴回来的结果、压缩摘要），送给模型前换成一句用户话。
// 这里还有把一条存下的消息变成界面看的样子（LineMessageView）的那一步。

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, ImageContent, Message, TextContent, ToolResultMessage, UserMessage }
  from '@earendil-works/pi-ai';
import { Value } from 'typebox/value';
import type { LineMessageView } from '../../shared/api/lines.ts';
import type { WelcomeStart } from '../../shared/welcome-start.ts';
import { splitReply } from '../../shared/line-reply.ts';
import { MessageWidgetSchema, type MessageWidget } from '../../shared/api/message-widgets.ts';
import type { LineMessageRow } from '../state/index.ts';

export type ReportOutcome = 'done' | 'failed' | 'paused';

/**
 * 后台线贴回发起它的线的那一条：做完了（最后那段话）、没做完（原因）、额度用完要等（只贴一次）。带子线的 id，
 * 界面据此画线卡片。
 */
export interface LineReportMessage {
  role: 'lineReport';
  lineId: string;
  title: string;
  outcome: ReportOutcome;
  text: string;
  timestamp: number;
  /** 跑完了但线自己说没做成（line_outcome）：一句原因。旧记录没有这一项，照旧按做完。 */
  unmet?: string;
}

/**
 * 系统通知（《优化清单》第 12 条，他 11-06 定：通知全部改成主线上的一条消息）：项目逾期、磁盘不够这类由系统发在主线上，
 * 来源是系统，不是他说的、也不是 Plasticine 说的。key 是这件事的稳定标识（同一件只发一次，app/ 那边按它记回执）；
 * brief 是系统通知（网页推送、Mac 通知）里那一句，不带私密内容（第 91 条）。
 */
export interface LineNoticeMessage {
  role: 'notice';
  key: string;
  text: string;
  brief: string;
  timestamp: number;
}

/**
 * 欢迎（2026-11-08《首次使用流程》）：建账号成功时 Plasticine 在主线上先打的招呼。固定文案（不调模型），下面带几个
 * 能点的「开始」。是 Plasticine 说的，但不是模型说的：送给模型时换成一句标明来历的话。
 */
export interface LineWelcomeMessage {
  role: 'welcome';
  text: string;
  starts: WelcomeStart[];
  timestamp: number;
}

/**
 * 来信（第 8 批第 6 条，他 11-09 定）：个人回顾的日报、周报写成来信放进资料库后，Plasticine 在主线说一句（text），
 * 下面带一张来信卡（spaceId、title）。是 Plasticine 写的（不是系统通知），送给模型时标明来历。key 是这封信的稳定标识。
 */
export interface LineLetterMessage {
  role: 'letter';
  key: string;
  text: string;
  spaceId: string;
  title: string;
  timestamp: number;
}

/** 贴到一条线上、不开一轮的消息：后台线的结果、系统通知、欢迎、来信。 */
export type PostedMessage = LineReportMessage | LineNoticeMessage | LineWelcomeMessage | LineLetterMessage;

/** 压缩摘要：不存进消息表（存在线的 summary 上），装上下文时放在最前面。 */
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
  }
}

/** 用户消息里附件那一句：只列名字和 id，正文用 attachment_text 读。 */
export interface AttachmentNote {
  id: string;
  name: string;
}

// 界面上一条工具结果最多显示这么长；全文在库里，模型拿到的是全文。
const RESULT_PREVIEW_CHARS = 400;
// 一步结束时那一句摘要：一行。
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
      { type: 'text', text: `${ATTACHMENT_NOTE_START}${names}；id：${ids}；正文用 attachment_text 读］` },
    ],
    timestamp: at,
  };
}

/** 附件 id 记在用户消息的第二段里；界面要列出来，送给能看图的模型时按它把图带上。 */
export function attachmentIds(message: UserMessage): string[] {
  if (typeof message.content === 'string') {
    return [];
  }
  const note = message.content.find((part): part is TextContent => part.type === 'text'
    && part.text.startsWith(ATTACHMENT_NOTE_START));
  const ids = note === undefined ? undefined : ATTACHMENT_IDS.exec(note.text)?.[1];
  return ids === undefined ? [] : ids.split(',').map((id) => id.trim()).filter((id) => id !== '');
}

/** 界面上用户说的话：不带附件那一段（附件另列）。 */
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
  const head = `后台线「${message.title}」（${message.lineId}）${ended}`;
  return `［${head}；这不是用户说的］\n${message.text}`;
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

/** 送给模型前：本内核自己的几种消息换成用户话（标明不是他说的），其余原样。 */
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
    return [message];
  });
}

export function contentText(content: string | readonly (TextContent | ImageContent | { type: string })[]): string {
  if (typeof content === 'string') {
    return content;
  }
  return content.flatMap((part) => (part.type === 'text' && 'text' in part ? [String(part.text)] : [])).join('\n');
}

/** 一条回答里给人看的文字（不含思考和工具调用）。 */
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

/** 工具结果那一句摘要：第一行非空的字，截成一行。 */
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

/** show_widgets 的结果里带的部件（details.widgets）；不合格式的不给界面。 */
function widgetsOf(details: unknown): MessageWidget[] {
  const widgets: unknown = typeof details === 'object' && details !== null ? Reflect.get(details, 'widgets')
    : undefined;
  return Array.isArray(widgets) ? widgets.filter((widget): widget is MessageWidget =>
    Value.Check(MessageWidgetSchema, widget)) : [];
}

/** 工具结果里带的那条线（开旁聊的 open_side_chat 写 details.childLineId）：界面据此画一行旁聊入口。 */
function childOf(details: unknown): string | null {
  const id: unknown = typeof details === 'object' && details !== null ? Reflect.get(details, 'childLineId')
    : undefined;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** 一条存下的消息给界面看的样子。sayOf 给工具调用配上大白话；找不到这件工具时就写工具名。 */
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
    const text = clip(contentText(message.content), RESULT_PREVIEW_CHARS);
    return view({ role: 'toolResult', text, toolCallId: message.toolCallId, tool: message.toolName, say,
      ok: !message.isError, summary: row.meta?.summary ?? null, widgets: widgetsOf(message.details),
      childLineId: childOf(message.details) });
  }
  if (message.role === 'lineReport') {
    const unmet = message.unmet !== undefined;
    return view({ role: 'lineReport', text: message.text, ok: message.outcome === 'done' && !unmet,
      stopReason: unmet ? 'unmet' : message.outcome, childLineId: message.lineId });
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
