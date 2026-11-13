// 线的数据（新内核，2026-11-05）：全部线的一览（首页「在做」、项目页「线」、对话里的后台线卡片都看它），和打开过的
// 每一条线的记录（主对话、后台线展开的步骤）。一条 SSE 上的 line_* 事件改本地副本；补不上（resync）时整份重读。
// 写操作都带 requestId：发送没拿到回执，用同一个标识重发不会出两条（服务端按标识去重）。

import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import { createRequestId } from '../../api/request-id.ts';
import { lineMessageText, lineQuoteInputs } from '../../api/quote-text.ts';
import { LINE_PAGE_DEFAULT, MAIN_LINE_ALIAS, type LineReply, type LineStreamEvent, type LineView, type OpenSideRequest,
  type ReactLineMessageRequest } from '../../api/shared.ts';
import type { Quote } from '../../api/types.ts';
import { Store } from '../../state/store.ts';
import { EMPTY_THREAD, applyLineEvent, upsertMessages, type LineThreadData } from './line-thread-data.ts';
import type { LinePulse } from '../mates/bot/bot-state.ts';

export { MAIN_LINE_ALIAS };

/** 一览里最多拿多少条：首页、项目页只看在做的和最近做完的。 */
const LIST_LIMIT = 100;

export interface LinesListData {
  lines: LineView[];
  loaded: boolean;
  error: string | null;
}

/**
 * 两份同一条线取新的：命令的回答和推送谁先到不一定（叫停时推送的「空闲」常比叫停请求的回答先到，回答里还是
 * 「在跑」），旧的不盖新的。
 */
export function newerLine(current: LineView | null, next: LineView): LineView {
  return current === null || current.id !== next.id || next.updatedAt >= current.updatedAt ? next : current;
}

function upsertLine(list: readonly LineView[], line: LineView): LineView[] {
  const kept = newerLine(list.find((item) => item.id === line.id) ?? null, line);
  const others = list.filter((item) => item.id !== line.id);
  return (kept.archivedAt == null ? [kept, ...others] : others).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 只发了附件：线上那句话得有字，照旧写「（附件）」。 */
const ATTACHMENTS_ONLY = '（附件）';

/**
 * 一条在跑的线这一刻在做的那一步（队友、主线头像的动效看它，11-13）：同一步的事件（回答的每一小段）不重复改。
 * 线不在跑了就拿掉。
 */
export function nextPulse(pulses: ReadonlyMap<string, LinePulse>, event: LineStreamEvent)
  : ReadonlyMap<string, LinePulse> {
  const set = (lineId: string, pulse: LinePulse): ReadonlyMap<string, LinePulse> => {
    const old = pulses.get(lineId);
    if (old?.phase === pulse.phase && old.tool === pulse.tool) return pulses;
    return new Map(pulses).set(lineId, pulse);
  };
  switch (event.type) {
    case 'line_changed': {
      if (event.line.status === 'running' || !pulses.has(event.line.id)) return pulses;
      const next = new Map(pulses);
      next.delete(event.line.id);
      return next;
    }
    case 'line_thinking': return set(event.lineId, { phase: 'thinking', tool: null });
    case 'line_text': return set(event.lineId, { phase: 'text', tool: null });
    case 'line_tool': return set(event.lineId, event.phase === 'started' ? { phase: 'tool', tool: event.tool }
      : { phase: 'thinking', tool: null });
    default: return pulses;
  }
}

export class LinesStore {
  readonly list = new Store<LinesListData>({ lines: [], loaded: false, error: null });
  readonly pulse = new Store<ReadonlyMap<string, LinePulse>>(new Map());
  private readonly api: PlasticineApi;
  private readonly hub: EventsHub;
  /** 打开过的线：键是打开时用的 id（主对话是 main），值是那条线的数据。 */
  private readonly threads = new Map<string, Store<LineThreadData>>();
  /** 主对话真正的 id（读到第一页之后才知道）。 */
  private mainId: string | null = null;
  /** 隐藏后仍保留最新版本，晚到的旧事件不能把已归档工作加回来。 */
  private readonly versions = new Map<string, LineView>();
  private stopListening: (() => void) | null = null;

  constructor(api: PlasticineApi, hub: EventsHub) {
    this.api = api;
    this.hub = hub;
  }

  start(): void {
    if (this.stopListening !== null) {
      return;
    }
    this.stopListening = this.hub.on((event) => {
      if (event.type === 'resync') {
        void this.reloadAll();
        return;
      }
      if (event.type !== 'line') {
        return;
      }
      const { event: lineEvent } = event;
      const pulses = nextPulse(this.pulse.get(), lineEvent);
      if (pulses !== this.pulse.get()) this.pulse.set(pulses);
      if (lineEvent.type === 'line_changed') {
        if (lineEvent.line.kind === 'main') {
          this.mainId = lineEvent.line.id;
        }
        this.list.set((data) => ({ ...data, lines: upsertLine(data.lines, this.remember(lineEvent.line)) }));
      }
      for (const [key, store] of this.threads) {
        const id = this.realId(key);
        store.set((data) => applyLineEvent(data, id, lineEvent));
      }
    });
    void this.loadList();
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = null;
  }

  /** 一条线的记录：第一次要的时候读最新一页。 */
  thread(lineId: string): Store<LineThreadData> {
    const existing = this.threads.get(lineId);
    if (existing !== undefined) {
      return existing;
    }
    const store = new Store<LineThreadData>(EMPTY_THREAD);
    this.threads.set(lineId, store);
    void this.loadLatest(lineId);
    return store;
  }

  /** 一览里的这一条（主对话用 main 也找得到）。 */
  lineOf(lineId: string): LineView | null {
    const id = this.realId(lineId);
    return this.list.get().lines.find((line) => line.id === id) ?? null;
  }

  private remember(line: LineView): LineView {
    const kept = newerLine(this.versions.get(line.id) ?? null, line);
    this.versions.set(line.id, kept);
    return kept;
  }

  async loadList(): Promise<void> {
    try {
      const { lines } = await this.api.lines.list({ limit: LIST_LIMIT });
      const main = lines.find((line) => line.kind === 'main');
      if (main !== undefined) {
        this.mainId = main.id;
      }
      const visible = lines.map((line) => this.remember(line)).filter((line) => line.archivedAt == null);
      this.list.set({ lines: visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        loaded: true, error: null });
    } catch (cause) {
      this.list.set((data) => ({ ...data, loaded: true, error: errorText(cause) }));
    }
  }

  async loadLatest(lineId: string): Promise<void> {
    const store = this.thread(lineId);
    try {
      const page = await this.api.lines.read(lineId, { limit: LINE_PAGE_DEFAULT });
      if (page.line.kind === 'main') {
        this.mainId = page.line.id;
      }
      store.set((data) => ({ ...data, line: page.line, messages: upsertMessages([], page.messages),
        hasMore: page.hasMore, queue: page.queue, loaded: true, error: null,
        live: page.line.status === 'running' ? data.live : null }));
    } catch (cause) {
      store.set((data) => ({ ...data, loaded: true, error: errorText(cause) }));
    }
  }

  async loadEarlier(lineId: string): Promise<void> {
    const store = this.thread(lineId);
    const first = store.get().messages[0];
    if (first === undefined || !store.get().hasMore || store.get().loadingEarlier) {
      return;
    }
    store.set((data) => ({ ...data, loadingEarlier: true }));
    try {
      const page = await this.api.lines.read(lineId, { before: first.seq, limit: LINE_PAGE_DEFAULT });
      store.set((data) => ({ ...data, messages: upsertMessages(data.messages, page.messages), hasMore: page.hasMore,
        loadingEarlier: false }));
    } catch (cause) {
      store.set((data) => ({ ...data, loadingEarlier: false, error: errorText(cause) }));
    }
  }

  /** 发一句：先放一条待发（立刻看得见），回执来了收掉；没送到的留着，可以用同一个标识重发。 */
  async send(lineId: string, text: string, attachments: string[] = [], quotes: readonly Quote[] = [],
    reply: LineReply | null = null): Promise<boolean> {
    const requestId = createRequestId();
    const store = this.thread(lineId);
    const words = text === '' && quotes.length === 0 ? ATTACHMENTS_ONLY : text;
    const request = { text: words, quotes: lineQuoteInputs(quotes),
      ...(reply === null ? {} : { replyTo: { seq: reply.seq } }) };
    const shown = lineMessageText(words, quotes);
    store.set((data) => ({ ...data, pending: [...data.pending, { requestId, text: shown, request, attachments,
      replyTo: reply, status: 'sending', error: null }] }));
    return this.deliver(lineId, requestId);
  }

  async resend(lineId: string, requestId: string): Promise<boolean> {
    this.thread(lineId).set((data) => ({ ...data, pending: data.pending.map((item) => (item.requestId === requestId
      ? { ...item, status: 'sending' as const, error: null } : item)) }));
    return this.deliver(lineId, requestId);
  }

  /** 没送到的那句不要了：把字交回调用方（放回输入框）。 */
  discard(lineId: string, requestId: string): string | null {
    const store = this.thread(lineId);
    const item = store.get().pending.find((candidate) => candidate.requestId === requestId);
    store.set((data) => ({ ...data, pending: data.pending.filter((candidate) => candidate.requestId !== requestId) }));
    return item?.text ?? null;
  }

  async withdraw(lineId: string, queueId: string): Promise<string | null> {
    return this.command(lineId, () => this.api.lines.withdraw(lineId, queueId, { requestId: createRequestId() }));
  }

  async sendNow(lineId: string, queueId: string): Promise<string | null> {
    return this.command(lineId, () => this.api.lines.sendNow(lineId, queueId, { requestId: createRequestId() }));
  }

  /** 任务四个动作（11-11）和从最近删除恢复：成了回 null，没成回一句原因。 */
  async pause(lineId: string): Promise<string | null> {
    return this.command(lineId, () => this.api.lines.pause(lineId, { requestId: createRequestId() }));
  }

  async resume(lineId: string): Promise<string | null> {
    return this.command(lineId, () => this.api.lines.resume(lineId, { requestId: createRequestId() }));
  }

  async end(lineId: string): Promise<string | null> {
    return this.command(lineId, () => this.api.lines.stop(lineId, { requestId: createRequestId() }));
  }

  async remove(lineId: string): Promise<string | null> {
    return this.command(lineId, () => this.api.lines.remove(lineId, { requestId: createRequestId() }));
  }

  async restore(lineId: string): Promise<string | null> {
    return this.command(lineId, () => this.api.lines.restore(lineId, { requestId: createRequestId() }));
  }

  /** 给一条消息加上或拿掉一个表情：成了回 null，没成回一句原因。 */
  async react(lineId: string, seq: number, emoji: string, on: boolean): Promise<string | null> {
    try {
      const { message } = await this.api.lines.react(lineId, { requestId: createRequestId(), seq,
        emoji: emoji as ReactLineMessageRequest['emoji'], on });
      this.thread(lineId).set((data) => ({ ...data, messages: upsertMessages(data.messages, [message]) }));
      return null;
    } catch (cause) {
      return errorText(cause);
    }
  }

  /** 开一条旁聊：开好了回那条线，没开成回一句原因。 */
  async openSide(request: Omit<OpenSideRequest, 'requestId'>): Promise<LineView | string> {
    try {
      const { line } = await this.api.lines.openSide({ requestId: createRequestId(), ...request });
      this.list.set((data) => ({ ...data, lines: upsertLine(data.lines, this.remember(line)) }));
      return line;
    } catch (cause) {
      return errorText(cause);
    }
  }

  private async deliver(lineId: string, requestId: string): Promise<boolean> {
    const store = this.thread(lineId);
    const item = store.get().pending.find((candidate) => candidate.requestId === requestId);
    if (item === undefined) {
      return true;
    }
    try {
      const { text, quotes, replyTo } = item.request;
      const response = await this.api.lines.send(lineId, { requestId, text,
        ...(quotes.length === 0 ? {} : { quotes }), ...(replyTo === undefined ? {} : { replyTo }),
        ...(item.attachments.length === 0 ? {} : { attachments: item.attachments }) });
      store.set((data) => {
        const next = { ...data, line: newerLine(data.line, response.line),
          pending: data.pending.filter((candidate) => candidate.requestId !== requestId) };
        if (response.message !== null) {
          return { ...next, messages: upsertMessages(next.messages, [response.message]) };
        }
        const queued = response.queued;
        return queued === null || next.queue.some((entry) => entry.id === queued.id) ? next
          : { ...next, queue: [...next.queue, queued] };
      });
      return true;
    } catch (cause) {
      store.set((data) => ({ ...data, pending: data.pending.map((candidate) => (candidate.requestId === requestId
        ? { ...candidate, status: 'failed' as const, error: errorText(cause) } : candidate)) }));
      return false;
    }
  }

  /** 撤回、立即发送、叫停、重试：成了回 null，没成回一句原因（界面就地说）。 */
  private async command(lineId: string, work: () => Promise<{ line: LineView }>): Promise<string | null> {
    try {
      const { line } = await work();
      this.list.set((data) => ({ ...data, lines: upsertLine(data.lines, this.remember(line)) }));
      const store = this.threads.get(lineId);
      store?.set((data) => ({ ...data, line: newerLine(data.line, line) }));
      return null;
    } catch (cause) {
      return errorText(cause);
    }
  }

  private realId(key: string): string {
    return key === MAIN_LINE_ALIAS ? (this.mainId ?? key) : key;
  }

  private async reloadAll(): Promise<void> {
    await Promise.all([this.loadList(), ...[...this.threads.keys()].map((key) => this.loadLatest(key))]);
  }
}
