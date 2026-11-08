// 跑一条线：每条线一个 pi Agent。一次「驱动」= 从库里装上下文 → continue() → 看这一轮怎么停的 → 重试 / 暂停 /
// 失败 / 做完。每条消息结束（message_end）立刻写库；每次请求前（prepareRequest）从库里重装上下文，所以库就是这条线
// 的全部真相：重启后从库接着跑，客户端从库读。模型停下时最后那段文字就是答案，线回到 idle。
// 排队的消息：这一轮要停时（finishTurn）交给 followUp，按顺序一起发出；「立即发送」交给 steer，插进正在跑的这一轮。
// 写进库那一刻才把排队的那条记成 sent，所以中途断掉也不丢。

import { Agent, runToolCall, type AgentMessage, type AgentTool, type AgentToolCall, type AgentToolResult,
  type AgentTurnContext, type BeforeToolCallContext, type BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai';
import type { LineStatus, LineStreamEvent } from '../../shared/api/lines.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import type { LineMessageMeta, LinePatch, LineRow, QueuedRow, StateService } from '../state/index.ts';
import { questionAnswerOrigin } from './ask-tools.ts';
import { classifyFailure, exhaustedText, RETRY_DELAYS_MS, retryingText, type FailureVerdict } from './failure.ts';
import type { HardLineGate } from './hard-line.ts';
import { answerText, convertToLlm, messageView, resultSummary, userMessage, type AttachmentNote,
  type PostedMessage, type SayOf } from './messages.ts';
import { buildTranscript, continuable, danglingCalls } from './transcript.ts';
import { sleepFor, type KernelTool, type Later, type LineScope, type ModelChoice, type ModelSource,
  type ToolArgs } from './types.ts';
import { seesImages, withImages, type ImagesOf } from './images.ts';
import { NO_ACTIVITY, queuedView, type Activity } from './views.ts';

export type DriveOutcome = 'done' | 'stopped' | 'failed' | 'paused' | 'shutdown';
export type DriveMode = 'continue' | 'resume';

export type RunnerState = Pick<StateService, 'lines' | 'lineMessages' | 'lineDays' | 'lineQueue' | 'lineApprovals'
  | 'asks' | 'transaction'>;

export interface Toolset {
  tools: AgentTool[];
  meta(name: string): KernelTool | undefined;
}

export interface RunnerHost {
  state: RunnerState;
  models: ModelSource;
  toolset(scope: LineScope): Toolset;
  prompt(line: LineRow): string;
  publish(event: LineStreamEvent): void;
  gate: HardLineGate;
  sayOf: SayOf;
  attachments(ids: readonly string[]): AttachmentNote[];
  /** 这些附件里的图（给能看图的模型）。 */
  images: ImagesOf;
  now(): Date;
  later: Later;
  /** 改线的状态并推 line_changed（kernel 做，带上实时状态那一行）。 */
  setStatus(lineId: string, status: LineStatus, patch?: LinePatch): void;
  /** 压缩（第四级）：上下文太长时把早先的消息换成摘要；force 是上下文已经超了、必须压。 */
  compact?(line: LineRow, messages: AgentMessage[], seqOf: (message: AgentMessage) => number | undefined,
    model: ModelChoice, options: { force: boolean; signal?: AbortSignal }): Promise<AgentMessage[]>;
  ended(lineId: string, outcome: DriveOutcome): void;
}

export const NO_MODEL_REASON = '还没连接模型：去「设置 · AI」连接 ChatGPT 或填一家国内模型的 key';
const THINKING_ACTIVITY = '在想…';
const WRITING_ACTIVITY = '在写回答…';
const UNCERTAIN_RESULT = '服务重启时这一步正在做，不知道做没做成，没有重做。先核实（读结果、查状态），再决定要不要重做。';

interface Handed {
  mode: 'steer' | 'followUp';
  message: UserMessage;
}

function argsOf(value: unknown): ToolArgs {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as ToolArgs : {};
}

export class LineRunner {
  readonly lineId: string;
  readonly #host: RunnerHost;
  readonly #agent: Agent;
  #scope: LineScope;
  readonly #modelPurpose: ModelPurpose;
  #toolset: Toolset = { tools: [], meta: () => undefined };
  #drive: Promise<void> | null = null;
  #control: AbortController | null = null;
  #stop: 'user' | 'shutdown' | null = null;
  #choice: ModelChoice | null = null;
  #lastAssistant: AssistantMessage | null = null;
  #attempts = 0;
  #compactedForOverflow = false;
  #activity: Activity = NO_ACTIVITY;
  readonly #inFlight = new Map<string, string>();
  // 刷新后要和实时一样（0063）：这一条回答的思考从什么时候开始、想了多久；每一步结果那一句，等工具结果写库时带上。
  #thinkingSince: number | null = null;
  #thinkingMs: number | null = null;
  readonly #summaries = new Map<string, string>();
  readonly #handed = new Map<string, Handed>();
  readonly #queueOf = new WeakMap<object, string>();
  readonly #seqOf = new WeakMap<object, number>();
  readonly #reports: PostedMessage[] = [];
  readonly #steeredReports = new Set<PostedMessage>();

  constructor(host: RunnerHost, line: LineRow) {
    this.lineId = line.id;
    this.#host = host;
    this.#scope = { lineId: line.id, kind: line.kind, projectId: line.projectId };
    this.#modelPurpose = line.modelPurpose ?? (line.kind === 'background' ? 'agent' : line.kind);
    if (line.sealedPrompt !== null) this.#modelPurpose = 'network_reply';
    this.#agent = new Agent({
      streamFn: host.models.streamFn,
      convertToLlm,
      transformContext: (messages, signal) => this.#transform(messages, signal),
      prepareRequest: () => {
        this.#refreshTools();
        this.#agent.state.tools = this.#toolset.tools;
        return { context: { messages: this.#transcript(), tools: this.#toolset.tools } };
      },
      beforeToolCall: (context, signal) => this.#beforeToolCall(context, signal),
      finishTurn: (turn) => this.#finishTurn(turn),
      steeringMode: 'all',
      followUpMode: 'all',
      sessionId: line.id,
      identity: { attribution: null },
    });
    this.#agent.subscribe((event) => this.#onEvent(event));
  }

  busy(): boolean {
    return this.#drive !== null;
  }

  /** 正在流式回答（steer 能直接插进去）。 */
  streaming(): boolean {
    return this.#agent.state.isStreaming;
  }

  activity(): Activity {
    return this.#activity;
  }

  /** 开一次驱动；已经在跑就不开（返回 false）。 */
  start(mode: DriveMode): boolean {
    if (this.#drive !== null) {
      return false;
    }
    this.#stop = null;
    this.#attempts = 0;
    this.#compactedForOverflow = false;
    this.#activity = { text: THINKING_ACTIVITY, since: this.#host.now().toISOString() };
    this.#drive = this.#run(mode);
    return true;
  }

  /** 等这次驱动结束（测试、关服务时用）。 */
  settled(): Promise<void> {
    return this.#drive ?? Promise.resolve();
  }

  /** 叫停（user）或关服务（shutdown）：中止这一轮；关服务时线的状态留着，重启后接着跑。 */
  abort(kind: 'user' | 'shutdown'): void {
    if (this.#drive === null) {
      return;
    }
    this.#stop = kind;
    this.#agent.abort();
    this.#control?.abort();
  }

  /** 「立即发送」：交给 steer，插进正在跑的这一轮（这一批工具做完后模型就看到）。 */
  steer(row: QueuedRow): void {
    const message = this.#messageFor(row);
    this.#handed.set(row.id, { mode: 'steer', message });
    this.#agent.steer(message);
  }

  /**
   * 撤回一条已经交给 pi 但还没写进库的排队消息：从 pi 的队列里拿掉它，其余的放回去。pi 已经把它取进这一轮
   * （队列里没有了、只是还没写库）就拿不回来了，回 taken；没交过或拿掉了回 removed。
   */
  unhand(queueId: string): 'removed' | 'taken' {
    const entry = this.#handed.get(queueId);
    if (entry === undefined) {
      return 'removed';
    }
    if (!this.#agent.peekQueuedMessages().includes(entry.message)) {
      return 'taken';
    }
    this.#handed.delete(queueId);
    // 只放回还在 pi 队列里的：已经被取进这一轮的再放就发两遍了。
    const pending = new Set(this.#agent.peekQueuedMessages());
    const rest = [...this.#handed.values()].filter((other) => other.mode === entry.mode && pending.has(other.message));
    if (entry.mode === 'steer') {
      this.#agent.clearSteeringQueue();
      for (const other of rest) {
        this.#agent.steer(other.message);
      }
      for (const report of this.#steeredReports) {
        if (pending.has(report)) {
          this.#agent.steer(report);
        }
      }
    } else {
      this.#agent.clearFollowUpQueue();
      for (const other of rest) {
        this.#agent.followUp(other.message);
      }
    }
    return 'removed';
  }

  /**
   * 后台线的结果、系统通知贴过来：在流式就插进这一轮；在跑但不在流式（重试、补跑工具）先存着，下次开跑前插；
   * 空闲由 kernel 直接写库。
   */
  deliver(report: PostedMessage): void {
    if (this.streaming()) {
      this.#steeredReports.add(report);
      this.#agent.steer(report);
      return;
    }
    this.#reports.push(report);
  }

  async #run(mode: DriveMode): Promise<void> {
    let outcome: DriveOutcome;
    try {
      outcome = await this.#loop(mode);
    } catch (error) {
      safeLog('error', 'line_drive_failed', { category: errorCategory(error) });
      this.#host.setStatus(this.lineId, 'failed', { failure: '这一轮在内核里出错了，没有做完：点重试接着做' });
      outcome = 'failed';
    } finally {
      this.#agent.clearAllQueues();
      this.#handed.clear();
      this.#inFlight.clear();
      this.#activity = NO_ACTIVITY;
      this.#control = null;
    }
    this.#flushReports();
    this.#drive = null;
    this.#host.ended(this.lineId, outcome);
  }

  async #loop(mode: DriveMode): Promise<DriveOutcome> {
    let resume = mode === 'resume';
    for (;;) {
      const choice = this.#host.models.current(this.#modelPurpose);
      if (choice === undefined) {
        return this.#fail(NO_MODEL_REASON);
      }
      this.#choice = choice;
      this.#control = new AbortController();
      this.#refreshTools();
      if (this.#attempts === 0) {
        this.#host.setStatus(this.lineId, 'running', { failure: null, pausedUntil: null, pauseReason: null });
      }
      if (resume) {
        resume = false;
        await this.#resumeTools(this.#control.signal);
        if (this.#stop === null) {
          for (const row of this.#host.state.lineQueue.queued(this.lineId)) {
            this.#persist(this.#messageFor(row));
          }
        }
      }
      if (this.#stop !== null) {
        return this.#stopped();
      }
      const transcript = this.#transcript();
      if (!continuable(transcript)) {
        return this.#done();
      }
      this.#agent.state.messages = transcript;
      this.#agent.state.tools = this.#toolset.tools;
      this.#agent.state.model = choice.model;
      this.#agent.state.thinkingLevel = choice.thinking;
      this.#lastAssistant = null;
      for (const report of this.#reports.splice(0)) {
        this.#steeredReports.add(report);
        this.#agent.steer(report);
      }
      await this.#agent.continue();
      const verdict = this.#verdict();
      if (verdict === 'stopped') {
        return this.#stopped();
      }
      if (verdict === 'done') {
        return this.#done();
      }
      if (verdict === 'incomplete') {
        this.#host.setStatus(this.lineId, 'paused', { pauseReason: 'output_limit', pausedUntil: null,
          failure: '这次输出达到长度上限，还没写完。点继续接着写。' });
        return 'paused';
      }
      const next = await this.#afterFailure(verdict, choice);
      if (next !== 'again') {
        return next;
      }
    }
  }

  #verdict(): 'done' | 'stopped' | 'incomplete' | FailureVerdict {
    const last = this.#lastAssistant;
    if (this.#stop !== null || last?.stopReason === 'aborted') {
      return 'stopped';
    }
    if (last?.stopReason === 'length') {
      return 'incomplete';
    }
    if (last?.stopReason !== 'error') {
      return 'done';
    }
    return classifyFailure(last, this.#host.now());
  }

  async #afterFailure(verdict: FailureVerdict, choice: ModelChoice): Promise<DriveOutcome | 'again'> {
    if (verdict.kind === 'overflow' && !this.#compactedForOverflow && this.#host.compact !== undefined) {
      this.#compactedForOverflow = true;
      const line = this.#host.state.lines.require(this.lineId);
      await this.#host.compact(line, this.#transcript(), (message) => this.#seqOf.get(message), choice,
        { force: true, ...(this.#control === null ? {} : { signal: this.#control.signal }) });
      return 'again';
    }
    if (verdict.kind === 'quota') {
      const pausedUntil = verdict.until.toISOString();
      this.#host.setStatus(this.lineId, 'paused', { pausedUntil, pauseReason: 'quota', failure: verdict.reason });
      return 'paused';
    }
    if (verdict.kind === 'retry' && this.#attempts < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[this.#attempts] ?? 0;
      this.#attempts += 1;
      this.#host.setStatus(this.lineId, 'running', { failure: retryingText(verdict.reason, this.#attempts) });
      return await sleepFor(this.#host.later, delay, this.#control?.signal) ? 'again' : this.#stopped();
    }
    const reason = verdict.kind === 'retry' ? exhaustedText(verdict.reason, this.#attempts) : verdict.reason;
    return this.#fail(reason);
  }

  #done(): DriveOutcome {
    this.#host.setStatus(this.lineId, 'idle', { failure: null, pausedUntil: null, pauseReason: null,
      pauseNoticedAt: null });
    return 'done';
  }

  #stopped(): DriveOutcome {
    if (this.#stop === 'shutdown') {
      return 'shutdown';
    }
    this.#host.setStatus(this.lineId, 'paused', { failure: null, pausedUntil: null, pauseReason: 'user' });
    return 'stopped';
  }

  #fail(reason: string): DriveOutcome {
    this.#host.setStatus(this.lineId, 'failed', { failure: reason, pauseReason: null, pausedUntil: null });
    return 'failed';
  }

  #refreshTools(): void {
    const line = this.#host.state.lines.require(this.lineId);
    this.#scope = { lineId: line.id, kind: line.kind, projectId: line.projectId };
    this.#toolset = this.#host.toolset(this.#scope);
  }

  /** 系统提示（含工具声明）+ 压缩摘要 + 摘要之后的消息；每次请求前从库里重装。 */
  #transcript(): AgentMessage[] {
    const line = this.#host.state.lines.require(this.lineId);
    const transcript = buildTranscript(this.#host.state, line, this.#host.prompt(line), this.#toolset.tools,
      this.#seqOf);
    return this.#choice !== null && seesImages(this.#choice.model)
      ? withImages(transcript, this.#host.images, this.#seqOf) : transcript;
  }

  async #transform(messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> {
    if (this.#host.compact === undefined || this.#choice === null) {
      return messages;
    }
    const line = this.#host.state.lines.require(this.lineId);
    return this.#host.compact(line, messages, (message) => this.#seqOf.get(message), this.#choice,
      { force: false, ...(signal === undefined ? {} : { signal }) });
  }

  async #beforeToolCall(context: BeforeToolCallContext, signal?: AbortSignal)
    : Promise<BeforeToolCallResult | undefined> {
    const tool = this.#toolset.meta(context.toolCall.name);
    if (tool === undefined) {
      return undefined;
    }
    const disabled = { block: true, reason: '这件工具已关闭。打开对应工具组后才能使用。' };
    if (tool.enabled?.() === false) {
      return disabled;
    }
    const result = await this.#host.gate.check(this.#scope, tool, context.toolCall, argsOf(context.args), signal);
    return tool.enabled?.() === false ? disabled : result;
  }

  /** 这一轮要停了（没有工具要做）：把排队的消息按顺序交给 followUp，pi 接着发出去。 */
  #finishTurn(turn: AgentTurnContext): undefined {
    const stopped = turn.message.stopReason === 'stop';
    if (!stopped || turn.toolResults.length > 0 || this.#stop !== null) {
      return undefined;
    }
    for (const row of this.#host.state.lineQueue.queued(this.lineId)) {
      if (this.#handed.has(row.id)) {
        continue;
      }
      const message = this.#messageFor(row);
      this.#handed.set(row.id, { mode: 'followUp', message });
      this.#agent.followUp(message);
    }
    return undefined;
  }

  #messageFor(row: QueuedRow): UserMessage {
    const message = userMessage(row.text, this.#host.attachments(row.attachments), this.#host.now().getTime());
    this.#queueOf.set(message, row.id);
    return message;
  }

  #setActivity(text: string): void {
    if (this.#activity.text === text) {
      return;
    }
    this.#activity = { text, since: this.#activity.since ?? this.#host.now().toISOString() };
    const line = this.#host.state.lines.get(this.lineId);
    if (line !== undefined) {
      this.#host.setStatus(this.lineId, line.status);
    }
  }

  #onEvent(event: Parameters<Parameters<Agent['subscribe']>[0]>[0]): void {
    const { lineId } = this;
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (update.type === 'text_delta') {
        this.#host.publish({ type: 'line_text', lineId, delta: update.delta });
      } else if (update.type === 'thinking_delta') {
        this.#thinkingSince ??= this.#host.now().getTime();
        this.#host.publish({ type: 'line_thinking', lineId, delta: update.delta });
      } else if (update.type === 'text_start' || update.type === 'toolcall_start') {
        this.#endThinking();
        if (update.type === 'text_start' && this.#inFlight.size === 0) {
          this.#setActivity(WRITING_ACTIVITY);
        }
      }
    } else if (event.type === 'message_start' && event.message.role === 'assistant') {
      this.#thinkingSince = null;
      this.#thinkingMs = null;
      if (this.#inFlight.size === 0) {
        this.#setActivity(THINKING_ACTIVITY);
      }
    } else if (event.type === 'message_end') {
      this.#persist(event.message);
    } else if (event.type === 'tool_execution_start') {
      const say = this.#host.sayOf(event.toolName, argsOf(event.args));
      this.#inFlight.set(event.toolCallId, say);
      this.#host.publish({ type: 'line_tool', lineId, phase: 'started', toolCallId: event.toolCallId,
        tool: event.toolName, say, ok: null, summary: null, durationMs: null });
      this.#setActivity(`${say}…`);
    } else if (event.type === 'tool_execution_end') {
      this.#toolEnded(event.toolCallId, event.toolName, event.result as AgentToolResult<unknown>, event.isError,
        event.durationMs ?? null);
    }
  }

  #toolEnded(toolCallId: string, tool: string, result: AgentToolResult<unknown> | undefined, isError: boolean,
    durationMs: number | null): void {
    const say = this.#inFlight.get(toolCallId) ?? this.#host.sayOf(tool, {});
    this.#inFlight.delete(toolCallId);
    const summary = resultSummary(result);
    if (summary !== null) {
      this.#summaries.set(toolCallId, summary);
    }
    this.#host.publish({ type: 'line_tool', lineId: this.lineId, phase: 'ended', toolCallId, tool, say,
      ok: !isError, summary, durationMs: durationMs === null ? null : Math.round(durationMs) });
    const next = [...this.#inFlight.values()].at(-1);
    this.#setActivity(next === undefined ? THINKING_ACTIVITY : `${next}…`);
  }

  /** 一条消息结束：立刻写库，推给客户端；排队的那条这时才记成发出。 */
  #persist(message: AgentMessage): void {
    if (message.role === 'system') {
      return;
    }
    // 关服务中止的那几步不记成失败：留着没有结果，重启后按「能不能安全重做」接着处理（硬线的接着等同一张卡）。
    if (this.#stop === 'shutdown' && message.role === 'toolResult' && message.isError) {
      return;
    }
    if (message.role === 'assistant') {
      this.#lastAssistant = message;
      const empty = answerText(message) === '' && !message.content.some((part) => part.type === 'toolCall');
      // 他叫停的那一下要留在记录里（读回来照样写「停下了」）；出错、关服务中止的空回答不记。送给模型时
      // 中止的回答本来就跳过（transcript.ts 的 trimFailedTail、pi-ai 自己也跳）。
      const keptStop = message.stopReason === 'aborted' && this.#stop === 'user';
      if ((message.stopReason === 'error' || message.stopReason === 'aborted') && empty && !keptStop) {
        return;
      }
    }
    const { state } = this.#host;
    const queueId = this.#queueOf.get(message);
    const row = state.transaction(() => {
      const saved = state.lineMessages.append(this.lineId, message.role, message, this.#metaFor(message));
      if (queueId !== undefined) {
        state.lineQueue.sent(queueId, saved.seq);
      }
      return saved;
    });
    if (message.role === 'lineReport' || message.role === 'notice') {
      this.#steeredReports.delete(message);
    }
    if (queueId !== undefined) {
      this.#handed.delete(queueId);
      this.#host.publish({ type: 'line_queue', lineId: this.lineId,
        queue: state.lineQueue.queued(this.lineId).map(queuedView) });
    }
    const calls = this.#lastAssistant?.content ?? [];
    const callArgs = (id: string): unknown => calls.find((part) => part.type === 'toolCall' && part.id === id)
      ?.['arguments' as never];
    this.#host.publish({ type: 'line_message', message: messageView(row, this.#host.sayOf, callArgs) });
  }

  #endThinking(): void {
    if (this.#thinkingSince !== null && this.#thinkingMs === null) {
      this.#thinkingMs = Math.max(0, this.#host.now().getTime() - this.#thinkingSince);
    }
  }

  #metaFor(message: AgentMessage): LineMessageMeta | null {
    if (message.role === 'user') {
      const queueId = this.#queueOf.get(message);
      const origin = queueId === undefined ? undefined : this.#host.state.lineQueue.get(queueId)?.origin;
      return { origin: origin ?? { kind: 'unknown' } };
    }
    if (message.role === 'assistant') {
      this.#endThinking();
      const thinkingMs = this.#thinkingMs;
      this.#thinkingSince = null;
      this.#thinkingMs = null;
      return thinkingMs === null ? null : { thinkingMs };
    }
    if (message.role === 'toolResult') {
      const summary = this.#summaries.get(message.toolCallId);
      this.#summaries.delete(message.toolCallId);
      const origin = questionAnswerOrigin(this.#host.state, this.lineId, message);
      if (summary === undefined && origin === undefined) {
        return null;
      }
      return { ...(summary === undefined ? {} : { summary }), ...(origin === undefined ? {} : { origin }) };
    }
    return null;
  }

  /** 驱动结束时还没写进库的后台线结果：直接写（线已经不跑了，插在哪都不会拆开一组工具调用和结果）。 */
  #flushReports(): void {
    for (const report of [...this.#steeredReports, ...this.#reports.splice(0)]) {
      this.#steeredReports.delete(report);
      this.#persist(report);
    }
  }

  /** 重启前停在一组工具调用中间：能安全重做的（或硬线还没放行过的）重做，其余如实写「不知道做没做成」。 */
  async #resumeTools(signal: AbortSignal): Promise<void> {
    const dangling = danglingCalls(this.#host.state, this.#host.state.lines.require(this.lineId));
    if (dangling === null) {
      return;
    }
    const head = dangling.assistant;
    this.#lastAssistant = head;
    const context = { messages: this.#transcript(), tools: this.#toolset.tools };
    for (const call of dangling.calls) {
      if (signal.aborted) {
        return;
      }
      const say = this.#host.sayOf(call.name, argsOf(call.arguments));
      this.#inFlight.set(call.id, say);
      this.#host.publish({ type: 'line_tool', lineId: this.lineId, phase: 'started', toolCallId: call.id,
        tool: call.name, say, ok: null, summary: null, durationMs: null });
      const outcome = this.#rerunnable(call)
        ? await runToolCall(call, { tools: this.#toolset.tools, assistantMessage: head, context, signal,
          beforeToolCall: (before, beforeSignal) => this.#beforeToolCall(before, beforeSignal) })
        : { result: { content: [{ type: 'text' as const, text: UNCERTAIN_RESULT }], details: {} }, isError: true };
      this.#toolEnded(call.id, call.name, outcome.result, outcome.isError, null);
      this.#persist({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: outcome.result.content,
        details: outcome.result.details, isError: outcome.isError, timestamp: this.#host.now().getTime() });
    }
  }

  #rerunnable(call: AgentToolCall): boolean {
    const approval = this.#host.state.lineApprovals.forCall(this.lineId, call.id);
    if (approval !== undefined && (approval.status === 'pending' || approval.status === 'approved')) {
      return true;
    }
    return this.#toolset.tools.find((tool) => tool.name === call.name)?.replay === 'safe';
  }
}
