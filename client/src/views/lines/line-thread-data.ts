import type { ConversationQuoteInput, LineMessageView, LineReply, LineStreamEvent, LineView, QueuedMessageView }
  from '../../api/shared.ts';

export interface LiveTool {
  toolCallId: string;
  tool: string;
  say: string;
  ok: boolean | null;
  summary: string | null;
  durationMs: number | null;
}

export interface LiveTurn {
  thinking: string;
  text: string;
  tools: LiveTool[];
}

export interface PendingLineSend {
  requestId: string;
  text: string;
  request: { text: string; quotes: ConversationQuoteInput[]; replyTo?: { seq: number } };
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

export function upsertMessages(list: readonly LineMessageView[], incoming: readonly LineMessageView[])
  : LineMessageView[] {
  const bySeq = new Map(list.map((message) => [message.seq, message]));
  for (const message of incoming) {
    bySeq.set(message.seq, message);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

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
