import { Agent, runToolCall, type AfterToolCallContext, type AfterToolCallResult, type AgentMessage, type AgentTool,
  type AgentToolCall, type AgentToolResult, type AgentTurnContext, type BeforeToolCallContext,
  type BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai';
import type { LineStatus, LineStreamEvent } from '../../shared/api/lines.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import type { LineMessageMeta, LinePatch, LineRow, QueuedRow, StateService } from '../state/index.ts';
import { questionAnswerOrigin } from './ask-tools.ts';
import { classifyFailure, exhaustedText, RETRY_DELAYS_MS, retryingText, type FailureVerdict } from './failure.ts';
import type { HardLineGate } from './hard-line.ts';
import { LoopGuard, STEP_LIMIT, type HaltCause } from './loop-guard.ts';
import { answerText, contentText, convertToLlm, messageView, resultSummary, userMessage, type AttachmentNote,
  type PostedMessage, type SayOf } from './messages.ts';
import { buildTranscript, continuable, danglingCalls } from './transcript.ts';
import { sleepFor, type KernelTool, type Later, type LineScope, type ModelChoice, type ModelSource,
  type ToolArgs } from './types.ts';
import { seesImages, withImages, withContextImages, type ImagesOf } from './images.ts';
import { NO_ACTIVITY, queuedView, type Activity } from './views.ts';

export type DriveOutcome = 'done' | 'stopped' | 'failed' | 'paused' | 'shutdown';
export type DriveMode = 'continue' | 'resume';

export type RunnerState = Pick<StateService, 'lines' | 'lineMessages' | 'lineDays' | 'lineQueue' | 'lineApprovals'
  | 'asks' | 'transaction'>;

export interface Toolset {
  tools: AgentTool[];
  deferred?: ReadonlyMap<string, AgentTool>;
  meta(name: string): KernelTool | undefined;
}

export interface RunnerHost {
  state: RunnerState;
  models: ModelSource;
  toolset(scope: LineScope): Toolset;
  prompt(line: LineRow): string;
  purpose?(line: LineRow): ModelPurpose;
  publish(event: LineStreamEvent): void;
  gate: HardLineGate;
  sayOf: SayOf;
  attachments(ids: readonly string[]): AttachmentNote[];
  images: ImagesOf;
  contextImages?: (lineId: string) => import('@earendil-works/pi-ai').ImageContent[];
  recall?: (call: { name: string; args: unknown }, resultText: string, shown: Set<string>) => string | null;
  now(): Date;
  later: Later;
  setStatus(lineId: string, status: LineStatus, patch?: LinePatch): void;
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
  #toolset: Toolset = { tools: [], meta: () => undefined };
  #drive: Promise<void> | null = null;
  #control: AbortController | null = null;
  #stop: 'user' | 'shutdown' | null = null;
  #choice: ModelChoice | null = null;
  #lastAssistant: AssistantMessage | null = null;
  #attempts = 0;
  #compactedForOverflow = false;
  #guard = new LoopGuard({ hardStops: false });
  #halt: string | null = null;
  readonly #recalled = new Set<string>();
  #activity: Activity = NO_ACTIVITY;
  readonly #inFlight = new Map<string, string>();
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
      afterToolCall: async (context) => this.#afterToolCall(context),
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

  streaming(): boolean {
    return this.#agent.state.isStreaming;
  }

  activity(): Activity {
    return this.#activity;
  }

  start(mode: DriveMode): boolean {
    if (this.#drive !== null) {
      return false;
    }
    this.#stop = null;
    this.#attempts = 0;
    this.#compactedForOverflow = false;
    this.#guard = new LoopGuard({ hardStops: this.#scope.kind === 'background' });
    this.#halt = null;
    this.#activity = { text: THINKING_ACTIVITY, since: this.#host.now().toISOString() };
    this.#drive = this.#run(mode);
    return true;
  }

  settled(): Promise<void> {
    return this.#drive ?? Promise.resolve();
  }

  abort(kind: 'user' | 'shutdown'): void {
    if (this.#drive === null) {
      return;
    }
    this.#stop = kind;
    this.#agent.abort();
    this.#control?.abort();
  }

  steer(row: QueuedRow): void {
    const message = this.#messageFor(row);
    this.#handed.set(row.id, { mode: 'steer', message });
    this.#agent.steer(message);
  }

  unhand(queueId: string): 'removed' | 'taken' {
    const entry = this.#handed.get(queueId);
    if (entry === undefined) {
      return 'removed';
    }
    if (!this.#agent.peekQueuedMessages().includes(entry.message)) {
      return 'taken';
    }
    this.#handed.delete(queueId);
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
      const line = this.#host.state.lines.require(this.lineId);
      const purpose = this.#host.purpose?.(line)
        ?? (line.sealedPrompt !== null ? 'network_reply'
          : line.modelPurpose ?? (line.kind === 'background' ? 'agent' : line.kind));
      const choice = this.#host.models.current(purpose);
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
      if (this.#halt !== null && this.#stop === null) {
        return this.#fail(this.#halt);
      }
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
    this.#scope = { lineId: line.id, kind: line.kind, projectId: line.projectId,
      ...(line.mateId == null ? {} : { actorId: line.mateId }) };
    this.#toolset = this.#host.toolset(this.#scope);
  }

  #transcript(): AgentMessage[] {
    const line = this.#host.state.lines.require(this.lineId);
    const transcript = buildTranscript(this.#host.state, line, this.#host.prompt(line), this.#toolset.tools,
      this.#seqOf, this.#toolset.deferred);
    const vision = this.#choice !== null && seesImages(this.#choice.model);
    const images = line.sealedPrompt === null ? [] : this.#host.contextImages?.(this.lineId) ?? [];
    const scoped = withContextImages(transcript, images, vision, this.#seqOf);
    return vision && line.sealedPrompt === null ? withImages(scoped, this.#host.images, this.#seqOf) : scoped;
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
    const guarded = this.#guard.before({ name: context.toolCall.name, args: context.args });
    if (guarded !== null) {
      this.#haltFor(guarded.halt, context.toolCall.name, argsOf(context.args));
      return { block: true, reason: guarded.block, terminate: this.#halt !== null };
    }
    if (this.#halt !== null) {
      return { block: true, reason: '这件事已经由内核停下，这一步不再做。', terminate: true };
    }
    const result = await this.#host.gate.check(this.#scope, tool, context.toolCall, argsOf(context.args), signal);
    return tool.enabled?.() === false ? disabled : result;
  }

  #afterToolCall(context: AfterToolCallContext): AfterToolCallResult | undefined {
    const args = argsOf(context.args);
    const resultText = contentText(context.result.content);
    const after = this.#guard.after({ name: context.toolCall.name, args }, context.isError, resultText);
    this.#haltFor(after.halt, context.toolCall.name, args);
    const recalled = context.isError ? null : this.#recall({ name: context.toolCall.name, args }, resultText);
    const texts = [...(recalled === null ? [] : [recalled]), ...after.notes];
    if (texts.length === 0 && this.#halt === null) {
      return undefined;
    }
    const notes = texts.map((text) => ({ type: 'text' as const, text }));
    return { content: [...context.result.content, ...notes], ...(this.#halt === null ? {} : { terminate: true }) };
  }

  #recall(call: { name: string; args: unknown }, resultText: string): string | null {
    try {
      return this.#host.recall?.(call, resultText, this.#recalled) ?? null;
    } catch (error) {
      safeLog('warn', 'experience_recall_failed', { category: errorCategory(error) });
      return null;
    }
  }

  #haltFor(cause: HaltCause | null, tool: string, args: ToolArgs): void {
    if (cause === null || this.#halt !== null) {
      return;
    }
    this.#halt = cause === 'step_limit'
      ? `已经做了 ${STEP_LIMIT} 步还没做完，先停下了。看一下进展，要接着做就点继续。`
      : `同一种操作连续没做成（${this.#host.sayOf(tool, args)}），先停下了。换个办法或者补上缺的东西，再点继续。`;
  }

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
      if (event.message.role === 'assistant') {
        this.#guard.step();
      }
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
    const meta = this.#toolset.meta(tool);
    if (meta !== undefined) { this.#host.gate.settled(this.lineId, toolCallId, meta, result, isError); }
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

  #persist(message: AgentMessage): void {
    if (message.role === 'system') {
      return;
    }
    if (this.#stop === 'shutdown' && message.role === 'toolResult' && message.isError) {
      return;
    }
    if (message.role === 'assistant') {
      this.#lastAssistant = message;
      const empty = answerText(message) === '' && !message.content.some((part) => part.type === 'toolCall');
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
    if (message.role === 'lineReport' || message.role === 'notice' || message.role === 'welcome'
      || message.role === 'letter' || message.role === 'handoff') {
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

  #flushReports(): void {
    for (const report of [...this.#steeredReports, ...this.#reports.splice(0)]) {
      this.#steeredReports.delete(report);
      this.#persist(report);
    }
  }

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
