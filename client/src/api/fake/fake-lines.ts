// 假的「线」（新内核，2026-11-05）：内存里的线、消息和排队，照 shared/api/lines.ts 的语义——空闲时发 = 开一轮，在跑时发
// = 进排队，这一轮结束按顺序发出；立即发送 = 插进正在跑的这一轮；叫停 = 中止这一轮。跑一轮按剧本（fake-line-script.ts）
// 一段段推 line_* 事件：思考摘要、每一步开始 / 结束（带大白话和用时）、回答的文字增量、写库的消息、线的状态。
// 测试里 stepMs 是 0：一轮在几个微任务里跑完；本地开发按步长慢慢走，看得出一段段长出来。

import type { LinesApi, ListLinesQuery, ReadLineQuery } from '../lines-client.ts';
import { ApiError } from '../errors.ts';
import {
  LINE_PAGE_DEFAULT,
  type AnswerLineWidgetRequest,
  type AnswerLineWidgetResponse,
  MAIN_LINE_ALIAS,
  type LineCommandRequest,
  type LineDetailsQuery,
  type LineDetailsResponse,
  type LineInputOrigin,
  type LineMessageView,
  type LineQueueResponse,
  type LineResponse,
  type LineStreamEvent,
  type LineView,
  type ListLinesResponse,
  type QueuedMessageView,
  type ReadLineResponse,
  type SendLineMessageRequest,
  type SendLineMessageResponse,
  withResolvedQuotes,
  BLANK_SIDE_TITLE,
  replyExcerpt,
  replyMarker,
  splitReply,
  type ChatsResponse,
  type OpenSideRequest,
  type ReactLineMessageRequest,
  type ReactLineMessageResponse,
  type ConversationQuoteInput,
  type ResolvedConversationQuote,
} from '../shared.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';
import { scriptFor, type LineScript } from './fake-line-script.ts';
import { answerFakeWidget } from './fake-line-widgets.ts';
import { fakeLineDetails, messageRef } from './fake-line-details.ts';

export const MAIN_LINE_ID = 'line-main';

export interface FakeLinesDeps {
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  now: () => Date;
  /** 一段之间隔多久（毫秒）；0 是测试。 */
  stepMs: number;
  /** 整篇笔记引用：那篇笔记的标题和正文（假的服务端不核对版本）。 */
  note?: (noteId: string) => { title: string; markdown: string } | undefined;
  /** 信息流「讨论」开旁聊时带上的那一条（假的服务端直接读假信息流）。 */
  feedItem?: (id: string) => { title: string; summary: string; publishedAt: string | null; site: string | null;
    sourceLabel: string } | undefined;
}

interface Run {
  cancelled: boolean;
  script: LineScript;
}

/** 假的服务端不核对笔记和书的版本：书和笔记的选段带着原文，直接用；整篇笔记读现在那一版。 */
function resolveQuote(quote: ConversationQuoteInput, note: FakeLinesDeps['note']): ResolvedConversationQuote {
  if (quote.kind === 'text') {
    return { label: quote.label, text: quote.text };
  }
  if (quote.kind === 'book') {
    return { label: '书', text: quote.bookReference.text, bookReference: quote.bookReference };
  }
  const reference = quote.noteReference;
  const found = note?.(reference.noteId);
  const label = `《${found?.title ?? '笔记'}》`;
  return { label, text: reference.scope === 'full' ? found?.markdown ?? '' : reference.text,
    noteReference: reference };
}

function notFound(): ApiError {
  return new ApiError({ kind: 'invalid', code: 'not_found', status: 404, message: '没有这条线。' });
}

export class FakeLines implements LinesApi {
  private readonly deps: FakeLinesDeps;
  private readonly lines = new Map<string, LineView>();
  private readonly messages = new Map<string, LineMessageView[]>();
  private readonly queues = new Map<string, QueuedMessageView[]>();
  private readonly runs = new Map<string, Run>();
  private readonly origins = new Map<string, LineInputOrigin>();
  private readonly queuedOrigins = new Map<string, LineInputOrigin>();
  private readonly projects = new Map<string, NonNullable<LineDetailsResponse['project']>>();
  private serial = 0;

  constructor(deps: FakeLinesDeps) {
    this.deps = deps;
    this.put(this.blank(MAIN_LINE_ID, 'main', 'Plasticine'));
  }

  // —— 接口 ——

  async list(query: ListLinesQuery): Promise<ListLinesResponse> {
    this.deps.session.require();
    const lines = [...this.lines.values()]
      .filter((line) => query.includeArchived === true || line.archivedAt == null)
      .filter((line) => query.kind === undefined || line.kind === query.kind)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { lines: structuredClone(lines.slice(0, query.limit ?? lines.length)) };
  }

  async read(lineId: string, query: ReadLineQuery): Promise<ReadLineResponse> {
    this.deps.session.require();
    const line = this.require(lineId);
    const all = this.messages.get(line.id) ?? [];
    const before = query.before ?? Number.POSITIVE_INFINITY;
    const earlier = all.filter((message) => message.seq < before);
    const limit = query.limit ?? LINE_PAGE_DEFAULT;
    const page = earlier.slice(-limit);
    return structuredClone({ line, messages: page, hasMore: earlier.length > page.length,
      queue: this.openQueue(line.id) });
  }

  async details(lineId: string, query: LineDetailsQuery): Promise<LineDetailsResponse> {
    this.deps.session.require();
    const line = this.require(lineId);
    const lookup = (ref: string): LineMessageView | undefined => [...this.messages.values()].flat()
      .find((row) => messageRef(row.lineId, row.seq) === ref);
    const details = fakeLineDetails(line, this.messages.get(line.id) ?? [], this.origins, lookup,
      line.projectId === null ? null : this.projects.get(line.projectId) ?? null, query);
    const queued = this.openQueue(line.id)[0];
    if (details.request === null && queued !== undefined) details.request = { text: queued.text, source: null };
    return details;
  }

  async send(lineId: string, body: SendLineMessageRequest): Promise<SendLineMessageResponse> {
    this.deps.session.require();
    const line = this.require(lineId);
    return this.deps.receipts.run('send', body.requestId, `POST /v2/lines/${line.id}/messages`, () => {
      const quoted = withResolvedQuotes(body.text, (body.quotes ?? []).map((quote) => resolveQuote(quote,
        this.deps.note)));
      const text = body.replyTo === undefined ? quoted : `${this.replyTo(line.id, body.replyTo.seq)}${quoted}`;
      if (line.kind === 'side' && line.title === BLANK_SIDE_TITLE) {
        this.change(line.id, { title: body.text.split('\n')[0]?.slice(0, 40) ?? BLANK_SIDE_TITLE });
      }
      const origin: LineInputOrigin = { kind: 'user', userText: body.text };
      if (['running', 'waiting', 'paused', 'queued'].includes(line.status)) {
        const queued = this.enqueue(line.id, text, body.attachments ?? [], origin);
        return { line: this.require(line.id), outcome: 'queued' as const, message: null, queued };
      }
      const message = this.start(line.id, text, body.attachments ?? [], origin);
      return { line: this.require(line.id), outcome: 'started' as const, message, queued: null };
    });
  }

  async answerWidget(lineId: string, body: AnswerLineWidgetRequest): Promise<AnswerLineWidgetResponse> {
    this.deps.session.require();
    const line = this.require(lineId);
    return this.deps.receipts.run('send', body.requestId, `POST /v2/lines/${line.id}/widgets`, () => {
      const list = this.messages.get(line.id) ?? [];
      const index = list.findLastIndex((message) => message.widgets.some((widget) => widget.id === body.widgetId));
      const holder = list[index];
      const widget = holder?.widgets.find((item) => item.id === body.widgetId);
      if (holder === undefined || widget === undefined) {
        throw new ApiError({ kind: 'invalid', code: 'not_found', status: 404, message: '没有这个部件。' });
      }
      this.serial += 1;
      const answered = answerFakeWidget(widget, body.answer, this.serial);
      const message = { ...holder, widgets: holder.widgets.map((item) => (item.id === widget.id ? answered.widget
        : item)) };
      list[index] = message;
      this.emit({ type: 'line_message', message: structuredClone(message) });
      if (answered.say === null) {
        return { line: this.require(line.id), message: structuredClone(message), outcome: 'recorded' as const };
      }
      if (['running', 'waiting', 'paused', 'queued'].includes(line.status)) {
        this.enqueue(line.id, answered.say, []);
        return { line: this.require(line.id), message: structuredClone(message), outcome: 'queued' as const };
      }
      this.start(line.id, answered.say, []);
      return { line: this.require(line.id), message: structuredClone(message), outcome: 'started' as const };
    });
  }

  async withdraw(lineId: string, queueId: string, body: LineCommandRequest): Promise<LineQueueResponse> {
    this.deps.session.require();
    const line = this.require(lineId);
    return this.deps.receipts.run('command', body.requestId, `POST /v2/lines/${line.id}/withdraw`, () => {
      const item = this.takeQueued(line.id, queueId, 'withdrawn');
      return { line: this.require(line.id), item };
    });
  }

  async sendNow(lineId: string, queueId: string, body: LineCommandRequest): Promise<LineQueueResponse> {
    this.deps.session.require();
    const line = this.require(lineId);
    return this.deps.receipts.run('command', body.requestId, `POST /v2/lines/${line.id}/send-now`, () => {
      const item = this.takeQueued(line.id, queueId, 'sent');
      if (this.runs.has(line.id)) {
        this.append(line.id, this.userMessage(line.id, item.text, item.attachments));
      } else {
        this.start(line.id, item.text, item.attachments);
      }
      return { line: this.require(line.id), item };
    });
  }

  async stop(lineId: string, body: LineCommandRequest): Promise<LineResponse> {
    this.deps.session.require();
    const line = this.require(lineId);
    return this.deps.receipts.run('command', body.requestId, `POST /v2/lines/${line.id}/stop`, () => {
      const run = this.runs.get(line.id);
      if (run !== undefined) {
        run.cancelled = true;
        this.runs.delete(line.id);
      }
      if (line.status !== 'idle') {
        this.append(line.id, this.assistant(line.id, { text: '', stopReason: 'aborted' }));
      }
      return { line: this.change(line.id, { status: 'paused', pauseReason: 'user', outcome: 'stopped',
        activity: null, activeSince: null, failure: null, pausedUntil: null }) };
    });
  }

  async retry(lineId: string, body: LineCommandRequest): Promise<LineResponse> {
    this.deps.session.require();
    const line = this.require(lineId);
    return this.deps.receipts.run('command', body.requestId, `POST /v2/lines/${line.id}/retry`, () => {
      const last = [...(this.messages.get(line.id) ?? [])].reverse().find((message) => message.role === 'user');
      this.change(line.id, { status: 'running', pauseReason: null, outcome: null, pausedUntil: null,
        failure: null, activeSince: this.now(), activity: null });
      if (this.openQueue(line.id).length > 0) this.sendNextQueued(line.id);
      else void this.play(line.id, scriptFor(last?.text ?? ''));
      return { line: this.require(line.id) };
    });
  }

  async react(lineId: string, body: ReactLineMessageRequest): Promise<ReactLineMessageResponse> {
    this.deps.session.require();
    const line = this.require(lineId);
    return this.deps.receipts.run('command', body.requestId, `POST /v2/lines/${line.id}/reactions`, () => {
      const list = this.messages.get(line.id) ?? [];
      const index = list.findIndex((message) => message.seq === body.seq);
      const held = list[index];
      if (held === undefined) throw notFound();
      const others = (held.reactions ?? []).filter((emoji) => emoji !== body.emoji);
      const message = { ...held, reactions: body.on ? [...others, body.emoji] : others };
      list[index] = message;
      this.emit({ type: 'line_message', message: structuredClone(message) });
      return { message: structuredClone(message) };
    });
  }

  async openSide(body: OpenSideRequest): Promise<{ line: LineView }> {
    this.deps.session.require();
    return this.deps.receipts.run('create', body.requestId, 'POST /v2/lines/side', () => {
      this.serial += 1;
      const item = body.from?.kind === 'feed' ? this.deps.feedItem?.(body.from.itemId) : undefined;
      const topic = item === undefined || body.from?.kind !== 'feed' ? null : { kind: 'feed' as const,
        ref: body.from.itemId, title: item.title, source: item.site ?? item.sourceLabel, at: item.publishedAt,
        excerpt: item.summary };
      const title = body.title ?? (topic === null ? BLANK_SIDE_TITLE : `讨论：${topic.title}`.slice(0, 59));
      const line = this.put(this.blank(`line-side-${this.serial}`, 'side', title, { topic }));
      return { line: structuredClone(line) };
    });
  }

  async chats(): Promise<ChatsResponse> {
    this.deps.session.require();
    const all = [...this.lines.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const main = this.require(MAIN_LINE_ID);
    const working = all.find((line) => line.kind === 'background' && line.status === 'running');
    const status = main.activity ?? (working === undefined ? main.lastAnswer
      : `${working.title} · ${working.activity?.replace(/…$/, '') ?? ''}`);
    return structuredClone({ main: { line: main, status },
      sides: all.filter((line) => line.kind === 'side' && line.archivedAt == null) });
  }

  // —— 给种子和测试用 ——

  /** 放一条线（或改一条线的字段），推 line_changed。 */
  put(line: LineView): LineView {
    this.lines.set(line.id, structuredClone(line));
    if (!this.messages.has(line.id)) {
      this.messages.set(line.id, []);
    }
    this.deps.bus.emit({ type: 'line', event: { type: 'line_changed', line: structuredClone(line) } });
    return line;
  }

  blank(id: string, kind: LineView['kind'], title: string, extra: Partial<LineView> = {}): LineView {
    const at = this.now();
    return { id, kind, parentLineId: null, parentMessageSeq: null, projectId: null, title, status: 'idle',
      pauseReason: null, outcome: null,
      pausedUntil: null, failure: null,
      activity: null, activeSince: null, queued: 0, lastAnswer: null, createdAt: at, updatedAt: at, ...extra };
  }

  /** 种子直接写一条消息（不跑剧本）。 */
  record(lineId: string, message: Omit<LineMessageView, 'lineId' | 'seq' | 'origin'>
    & { origin?: LineMessageView['origin'] }, origin?: LineInputOrigin): LineMessageView {
    return this.append(lineId, { ...message, origin: message.origin ?? null, lineId,
      seq: this.nextSeq(lineId) }, origin);
  }

  /** 系统发在主线上的一条通知（项目逾期、磁盘不够）：text 是正文，brief 是系统通知里那一句。 */
  notice(text: string, brief: string): LineMessageView {
    return this.record(MAIN_LINE_ID, { ...this.assistant(MAIN_LINE_ID, { text, summary: brief }), role: 'notice' });
  }

  seedProject(id: string, title: string): void {
    this.projects.set(id, { id, title });
  }

  /** 种子：在这条线的排队里放一条。 */
  seedQueued(lineId: string, text: string, status: 'queued' | 'inserted' = 'queued',
    origin: LineInputOrigin = { kind: 'user', userText: text }): QueuedMessageView {
    const item = this.enqueue(lineId, text, [], origin);
    if (status === 'queued') {
      return item;
    }
    const inserted = { ...item, status };
    this.queues.set(lineId, (this.queues.get(lineId) ?? []).map((entry) => (entry.id === item.id ? inserted : entry)));
    this.queueChanged(lineId);
    return inserted;
  }

  /** 这条线的全部消息，从旧到新（假图书的「讨论」、假搜索用）。 */
  /** 假查找用：所有线（主线、旁聊、后台线）。 */
  allLines(): LineView[] {
    return [...this.lines.values()];
  }

  messagesOf(lineId: string): LineMessageView[] {
    return structuredClone(this.messages.get(lineId === MAIN_LINE_ALIAS ? MAIN_LINE_ID : lineId) ?? []);
  }

  /** 全部线（假项目挑这个项目下的线用）。 */
  all(): LineView[] {
    return structuredClone([...this.lines.values()]);
  }

  find(lineId: string): LineView | undefined {
    return this.lines.get(lineId === MAIN_LINE_ALIAS ? MAIN_LINE_ID : lineId);
  }

  change(lineId: string, patch: Partial<LineView>): LineView {
    const line = this.require(lineId);
    const queued = this.openQueue(line.id).length;
    const next = { ...line, ...patch, queued, updatedAt: this.now() };
    if (queued > 0 && next.outcome === 'done') next.outcome = null;
    return this.put(next);
  }

  /** 硬线卡答了：这一轮接着跑（同意 → 做完这一步，不同意 → 把「他没同意」交回去）。 */
  resume(lineId: string, script: LineScript): void {
    this.change(lineId, { status: 'running', activeSince: this.now() });
    void this.play(lineId, script);
  }

  // —— 跑一轮 ——

  private start(lineId: string, text: string, attachments: string[], origin?: LineInputOrigin): LineMessageView {
    const message = this.append(lineId, this.userMessage(lineId, text, attachments), origin);
    this.change(lineId, { status: 'running', pauseReason: null, outcome: null, pausedUntil: null,
      activity: null, activeSince: this.now(), failure: null });
    void this.play(lineId, scriptFor(text));
    return message;
  }

  private async play(lineId: string, script: LineScript): Promise<void> {
    const run: Run = { cancelled: false, script };
    this.runs.set(lineId, run);
    const live = (): boolean => !run.cancelled && this.runs.get(lineId) === run;
    for (const piece of script.thinking) {
      await this.tick();
      if (!live()) return;
      this.emit({ type: 'line_thinking', lineId, delta: piece });
    }
    const steps = script.steps.map((step, index) => ({ ...step, toolCallId: `call-${this.serial + index + 1}` }));
    this.serial += steps.length;
    if (steps.length > 0 || script.thinking.length > 0) {
      this.append(lineId, this.assistant(lineId, { text: '', thinking: script.thinking.join(''),
        steps: steps.map((step) => ({ toolCallId: step.toolCallId, tool: step.tool, say: step.say })),
        stopReason: steps.length > 0 ? 'toolUse' : 'stop' }));
    }
    for (const step of steps) {
      if (!live()) return;
      this.change(lineId, { activity: `${step.say}…` });
      this.emit({ type: 'line_tool', lineId, phase: 'started', toolCallId: step.toolCallId, tool: step.tool,
        say: step.say, ok: null, summary: null, durationMs: null });
      await this.tick(3);
      if (!live()) return;
      this.emit({ type: 'line_tool', lineId, phase: 'ended', toolCallId: step.toolCallId, tool: step.tool,
        say: step.say, ok: step.ok ?? true, summary: step.result, durationMs: Math.max(1, this.deps.stepMs * 3) });
      this.append(lineId, { ...this.assistant(lineId, { text: step.result }), role: 'toolResult',
        toolCallId: step.toolCallId, tool: step.tool, say: step.say, ok: step.ok ?? true });
    }
    if (script.hold !== undefined) {
      this.runs.delete(lineId);
      script.hold(lineId);
      return;
    }
    this.change(lineId, { activity: null });
    for (const piece of script.answer) {
      await this.tick();
      if (!live()) return;
      this.emit({ type: 'line_text', lineId, delta: piece });
    }
    this.runs.delete(lineId);
    const answer = script.answer.join('');
    this.append(lineId, this.assistant(lineId, { text: answer, stopReason: 'stop' }));
    this.change(lineId, { status: 'idle', outcome: 'done', pauseReason: null, activity: null, activeSince: null,
      lastAnswer: answer.slice(0, 120) });
    this.sendNextQueued(lineId);
  }

  private sendNextQueued(lineId: string): void {
    const next = this.openQueue(lineId)[0];
    if (next === undefined) {
      return;
    }
    this.takeQueued(lineId, next.id, 'sent');
    this.start(lineId, next.text, next.attachments, this.queuedOrigins.get(next.id));
  }

  private tick(count = 1): Promise<void> {
    const wait = this.deps.stepMs * count;
    return wait === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, wait));
  }

  // —— 小工具 ——

  private require(lineId: string): LineView {
    const line = this.find(lineId);
    if (line === undefined) {
      throw notFound();
    }
    return structuredClone(line);
  }

  private now(): string {
    return this.deps.now().toISOString();
  }

  private emit(event: LineStreamEvent): void {
    this.deps.bus.emit({ type: 'line', event });
  }

  private nextSeq(lineId: string): number {
    const list = this.messages.get(lineId) ?? [];
    return (list.at(-1)?.seq ?? 0) + 1;
  }

  private append(lineId: string, message: LineMessageView, origin?: LineInputOrigin): LineMessageView {
    const list = this.messages.get(lineId) ?? [];
    const actual = message.role === 'user' ? origin ?? message.origin ?? { kind: 'unknown' as const } : null;
    // 系统通知（《优化清单》第 12 条）：来源是系统，和服务端一样。
    const shown = message.role === 'notice' ? { kind: 'system' as const } : actual;
    const placed = { ...message, origin: shown, seq: this.nextSeq(lineId) };
    list.push(placed);
    this.messages.set(lineId, list);
    if (actual !== null) this.origins.set(messageRef(lineId, placed.seq), actual);
    this.emit({ type: 'line_message', message: structuredClone(placed) });
    return placed;
  }

  private userMessage(lineId: string, text: string, attachments: string[]): LineMessageView {
    const said = splitReply(text);
    return { ...this.assistant(lineId, { text: said.text, replyTo: said.replyTo }), role: 'user', attachments };
  }

  /** 回复记号：和服务端一样写在那句话最前面。 */
  private replyTo(lineId: string, seq: number): string {
    const target = (this.messages.get(lineId) ?? []).find((message) => message.seq === seq);
    if (target === undefined) {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400, message: '要回复的那一条不在了。' });
    }
    return replyMarker({ seq, author: target.role === 'user' ? '你' : 'Plasticine', text: replyExcerpt(target.text) });
  }

  private assistant(lineId: string, fields: Partial<LineMessageView>): LineMessageView {
    return { lineId, seq: 0, role: 'assistant', origin: null, text: '', thinking: null, thinkingMs: null, steps: [],
      toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null,
      attachments: [], widgets: [], createdAt: this.now(), ...fields };
  }

  private openQueue(lineId: string): QueuedMessageView[] {
    return (this.queues.get(lineId) ?? []).filter((item) => item.status === 'queued' || item.status === 'inserted');
  }

  private enqueue(lineId: string, text: string, attachments: string[], origin?: LineInputOrigin): QueuedMessageView {
    this.serial += 1;
    const item: QueuedMessageView = { id: `queue-${this.serial}`, lineId, text, attachments, status: 'queued',
      origin: origin ?? { kind: 'unknown' }, createdAt: this.now() };
    this.queues.set(lineId, [...(this.queues.get(lineId) ?? []), item]);
    this.queuedOrigins.set(item.id, item.origin);
    this.queueChanged(lineId);
    return item;
  }

  private takeQueued(lineId: string, queueId: string, status: 'sent' | 'withdrawn'): QueuedMessageView {
    const list = this.queues.get(lineId) ?? [];
    const item = list.find((candidate) => candidate.id === queueId);
    if (item === undefined || item.status !== 'queued') {
      throw new ApiError({ kind: 'failed', code: 'queue_closed', status: 409, message: '这条已经发出或撤回了。' });
    }
    const next = { ...item, status };
    this.queues.set(lineId, list.map((candidate) => (candidate.id === queueId ? next : candidate)));
    this.queueChanged(lineId);
    return next;
  }

  private queueChanged(lineId: string): void {
    this.emit({ type: 'line_queue', lineId, queue: structuredClone(this.openQueue(lineId)) });
    this.change(lineId, {});
  }
}
