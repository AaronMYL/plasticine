// 一条线在界面上的数据（新内核，2026-11-05）：读到的消息、排队、正在流式的那一段，和还没回执的发送。事件怎么改它
// 都在这里，是纯函数，测得到。line-store.ts 只管读接口、挂事件、发请求。

import type { ConversationQuoteInput, LineMessageView, LineReply, LineStreamEvent, LineView, QueuedMessageView }
  from '../../api/shared.ts';

/** 一步的实时状态（line_tool 开始 / 结束）。 */
export interface LiveTool {
  toolCallId: string;
  tool: string;
  say: string;
  ok: boolean | null;
  summary: string | null;
  durationMs: number | null;
}

/** 正在跑的这一轮里还没写进库的部分。 */
export interface LiveTurn {
  thinking: string;
  text: string;
  tools: LiveTool[];
}

/** 发出去还没拿到回执的一句（没送到时带 error，可以用同一个标识重发）。 */
export interface PendingLineSend {
  requestId: string;
  /** 回执前显示的正文：引用块在前（和服务端存下的格式一样），回执到了按它对上收掉。 */
  text: string;
  /** 真正发出去的：用户的话和结构化的引用分开（引用不占这句话的字数上限）。 */
  request: { text: string; quotes: ConversationQuoteInput[]; replyTo?: { seq: number } };
  /** 回复的那一条（回执前气泡上就画「回复 Plasticine：……」）。 */
  replyTo?: LineReply | null;
  attachments: string[];
  status: 'sending' | 'failed';
  error: string | null;
}

export interface LineThreadData {
  line: LineView | null;
  messages: LineMessageView[];
  hasMore: boolean;
  queue: QueuedMessageView[];
  live: LiveTurn | null;
  /** 每一步结束时服务端给的一句结果摘要（toolCallId → 摘要），比工具原文短。 */
  summaries: ReadonlyMap<string, string>;
  pending: PendingLineSend[];
  loaded: boolean;
  loadingEarlier: boolean;
  error: string | null;
}

export const EMPTY_THREAD: LineThreadData = {
  line: null,
  messages: [],
  hasMore: false,
  queue: [],
  live: null,
  summaries: new Map(),
  pending: [],
  loaded: false,
  loadingEarlier: false,
  error: null,
};

const EMPTY_LIVE: LiveTurn = { thinking: '', text: '', tools: [] };

/** 按 seq 放进去：同一个 seq 换成新的，其余按 seq 排。 */
export function upsertMessages(list: readonly LineMessageView[], incoming: readonly LineMessageView[])
  : LineMessageView[] {
  const bySeq = new Map(list.map((message) => [message.seq, message]));
  for (const message of incoming) {
    bySeq.set(message.seq, message);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** 这条线不在跑了：流式那一段收掉（写进库的消息已经到了）。 */
function settleLive(data: LineThreadData, line: LineView): LiveTurn | null {
  return line.status === 'running' ? data.live : null;
}

function withSummary(summaries: ReadonlyMap<string, string>, id: string, summary: string | null)
  : ReadonlyMap<string, string> {
  if (summary === null || summary.trim() === '') {
    return summaries;
  }
  const next = new Map(summaries);
  next.set(id, summary);
  return next;
}

/** 他说的一句写进库了：同样字的那条待发收掉（回执晚到也不会出两条）。 */
function dropPending(pending: readonly PendingLineSend[], message: LineMessageView): PendingLineSend[] {
  if (message.role !== 'user' || message.origin?.kind !== 'user') {
    return [...pending];
  }
  const index = pending.findIndex((item) => item.text === message.text);
  return index < 0 ? [...pending] : [...pending.slice(0, index), ...pending.slice(index + 1)];
}

function toolEvent(live: LiveTurn, event: Extract<LineStreamEvent, { type: 'line_tool' }>): LiveTurn {
  const tool: LiveTool = { toolCallId: event.toolCallId, tool: event.tool, say: event.say, ok: event.ok,
    summary: event.summary, durationMs: event.durationMs };
  const others = live.tools.filter((item) => item.toolCallId !== event.toolCallId);
  return { ...live, tools: [...others, tool] };
}

/** 一条线事件改这一条线的数据；不是这条线的事件原样返回。lineId 是这条线真正的 id。 */
export function applyLineEvent(data: LineThreadData, lineId: string, event: LineStreamEvent): LineThreadData {
  switch (event.type) {
    case 'line_changed':
      if (event.line.id !== lineId || (data.line !== null && event.line.updatedAt < data.line.updatedAt)) return data;
      return { ...data, line: event.line, live: settleLive(data, event.line) };
    case 'line_text':
      if (event.lineId !== lineId) return data;
      return { ...data, live: { ...(data.live ?? EMPTY_LIVE), text: (data.live?.text ?? '') + event.delta } };
    case 'line_thinking':
      if (event.lineId !== lineId) return data;
      return { ...data, live: { ...(data.live ?? EMPTY_LIVE), thinking: (data.live?.thinking ?? '') + event.delta } };
    case 'line_tool':
      if (event.lineId !== lineId) return data;
      return { ...data, live: toolEvent(data.live ?? EMPTY_LIVE, event),
        summaries: withSummary(data.summaries, event.toolCallId, event.summary) };
    case 'line_message': {
      const { message } = event;
      if (message.lineId !== lineId) return data;
      // 回答写进库了：流式的字和思考收掉（库里那条已经有了），这一轮的步骤还在跑就留着。
      const live = message.role === 'assistant' && data.live !== null
        ? { ...data.live, text: '', thinking: '' } : data.live;
      return { ...data, messages: upsertMessages(data.messages, [message]), live,
        pending: dropPending(data.pending, message) };
    }
    case 'line_queue':
      if (event.lineId !== lineId) return data;
      return { ...data, queue: event.queue };
  }
}
