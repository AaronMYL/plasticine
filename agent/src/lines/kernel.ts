// 新内核的门面：线的列表、读、发消息、撤回 / 立即发送排队的消息、叫停、重试、开后台线；启动时接着跑重启前没跑完的线。
// 只做六件事（上下文、循环、线、触发、边界、看得见管得住），不做验收轮、诊断轮、契约、回执审查、认领租约、失败签名。
// 写库的部分是同步的，可以放进接口的幂等事务里；开跑、推事件放在 after（事务提交之后）做。

import type { Ask, AskPurpose } from '../../shared/state.ts';
import { MAIN_LINE_ALIAS, type ChatsResponse, type LineMessageView, type LineStatus, type LineTopic, type LineView,
  type QueuedMessageView } from '../../shared/api/lines.ts';
import type { AskResolver } from '../attention/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import type { LinePatch, LineRow, QueuedRow } from '../state/index.ts';
import { lineRef } from '../state/index.ts';
import { askUserTool, questionResolver } from './ask-tools.ts';
import { HardLineGate } from './hard-line.ts';
import { imagesOf } from './images.ts';
import { DEFAULT_TIME_ZONE, LineError, MAX_BACKGROUND_LINES, NOW, type After, type KernelOptions, type KernelState,
  type OpenLine, type SendInput, type SendResult } from './kernel-types.ts';
import { lineTools, type LineControl } from './line-tools.ts';
import { outcomeTool } from './outcome-tool.ts';
import { isAssistant, messageView, userMessage, type AttachmentNote, type LineNoticeMessage,
  type LineLetterMessage, type LineWelcomeMessage, type PostedMessage,
  type ReportOutcome } from './messages.ts';
import { pageSubmitAskTool } from './page-submit-tool.ts';
import { linePrompt } from './prompt.ts';
import { productMap } from './product-map.ts';
import { lineReport, pauseNotice } from './reports.ts';
import { lineResult } from './results.ts';
import { LineRunner, type DriveMode, type DriveOutcome, type RunnerHost, type Toolset } from './runner.ts';
import { realLater, type KernelTool, type Later, type LineScope } from './types.ts';
import { lineView, NO_ACTIVITY, pageMessages, queuedView } from './views.ts';
import { rollDay } from './day-context.ts';
import { readResultTool } from './large-results.ts';
import { chats, openSideTool, replyFor, retitled, SIDES_LIMIT, toggleReaction, type SideControl }
  from './side-chats.ts';
import type { WelcomeStart } from '../../shared/welcome-start.ts';
import { replyMarker } from '../../shared/line-reply.ts';
import { AnswerWaits } from './waits.ts';

export class LineKernel implements LineControl, SideControl {
  readonly #options: KernelOptions;
  readonly #state: KernelState;
  readonly #now: () => Date;
  readonly #later: Later;
  readonly #max: number;
  readonly #waits = new AnswerWaits();
  readonly #gate: HardLineGate;
  readonly #runners = new Map<string, LineRunner>();
  readonly #timers = new Map<string, () => void>();
  readonly #tools: KernelTool[];
  readonly #host: RunnerHost;
  #stopping = false;

  constructor(options: KernelOptions) {
    this.#options = options;
    this.#state = options.state;
    this.#now = options.now ?? (() => new Date());
    this.#later = options.later ?? realLater;
    this.#max = options.maxBackground ?? MAX_BACKGROUND_LINES;
    const waiting = (lineId: string, on: boolean): void => this.#waiting(lineId, on);
    const shuttingDown = (): boolean => this.#stopping;
    const waitHost = { state: this.#state, desk: options.desk, waits: this.#waits, waiting, now: this.#now,
      shuttingDown };
    this.#gate = new HardLineGate(waitHost);
    const askHost = waitHost;
    const submits = options.submits === undefined ? [] : [pageSubmitAskTool(askHost, options.submits)];
    const asking = (options.askTools ?? []).map((make) => make(askHost));
    this.#tools = [askUserTool(askHost), ...lineTools(this), outcomeTool(this.#state), readResultTool(this.#state),
      openSideTool(this, this.#state), ...submits, ...asking, ...(options.tools ?? [])];
    this.#host = this.#runnerHost();
  }

  #runnerHost(): RunnerHost {
    const meta = new Map(this.#tools.map((tool) => [tool.name, tool]));
    const sayOf = (name: string, args: Record<string, unknown>): string => meta.get(name)?.say(args) ?? name;
    return {
      state: this.#state,
      models: this.#options.models,
      toolset: (scope: LineScope): Toolset => ({
        tools: (this.#state.lines.get(scope.lineId)?.sealedPrompt ?? null) !== null ? []
          : this.#tools.filter((tool) => (tool.enabled?.() ?? true)
            && (tool.lineKinds === undefined || tool.lineKinds.includes(scope.kind))).map((tool) => tool.create(scope)),
        meta: (name) => meta.get(name),
      }),
      prompt: (line) => line.sealedPrompt ?? [linePrompt(this.#state, line, this.#options.publicUrl?.()),
        productMap(this.#tools.filter((tool) => (tool.enabled?.() ?? true)
          && (tool.lineKinds === undefined || tool.lineKinds.includes(line.kind)))),
        this.#options.skillsContext?.(line.id) ?? ''].filter((part) => part.trim() !== '').join('\n\n'),
      publish: (event) => this.#options.publish(event),
      gate: this.#gate,
      sayOf,
      attachments: (ids) => this.#notes(ids),
      images: (ids) => imagesOf(this.#state, ids),
      now: this.#now,
      later: this.#later,
      setStatus: (lineId, status, patch) => this.#setStatus(lineId, status, patch),
      ...(this.#options.compact === undefined ? {} : { compact: this.#options.compact }),
      ended: (lineId, outcome) => this.#ended(lineId, outcome),
    };
  }

  /** 要你定卡答了之后怎么接着：硬线卡、问他的卡。由 assemble 挂到 AskDesk 的分派上。 */
  resolvers(): Partial<Record<AskPurpose, AskResolver>> {
    const answered = (ask: Ask): void => this.#answered(ask);
    return { line_approval: this.#gate.resolver(answered), line_question: questionResolver(answered) };
  }

  /** 服务启动：主线补齐；在跑 / 在等的线接着跑；暂停的到点再跑；排着队的发出去。 */
  start(): void {
    this.#gate.recover();
    this.#state.lines.main();
    for (const line of this.#state.lines.withStatus(['running', 'waiting', 'queued']).reverse()) {
      if (line.status === 'queued' && this.#state.lineMessages.last(line.id) === undefined) {
        this.#pump(line.id);
      } else {
        this.#launch(line.id, 'resume');
      }
    }
    for (const line of this.#state.lines.withStatus(['paused'])) {
      this.#schedulePause(line);
    }
    const main = this.#state.lines.main();
    if (main.status === 'idle') {
      this.#pump(main.id);
    }
    this.#schedule();
  }

  /** 关服务：中止每一轮（线的状态留着，重启后接着跑），取消定时。 */
  async stop(): Promise<void> {
    this.#stopping = true;
    for (const cancel of this.#timers.values()) {
      cancel();
    }
    this.#timers.clear();
    for (const runner of this.#runners.values()) {
      runner.abort('shutdown');
    }
    await Promise.all([...this.#runners.values()].map((runner) => runner.settled()));
  }

  /** 等所有线都停下来（测试用：跑完一轮可能接着开下一轮，所以等到没有在跑的为止）。 */
  async settled(): Promise<void> {
    for (;;) {
      const busy = [...this.#runners.values()].filter((runner) => runner.busy());
      if (busy.length === 0) {
        return;
      }
      await Promise.all(busy.map((runner) => runner.settled()));
    }
  }

  // —— 读 ——

  line(lineId: string): LineRow {
    if (lineId === MAIN_LINE_ALIAS) {
      return this.#state.lines.main();
    }
    const line = this.#state.lines.get(lineId);
    if (line === undefined) {
      throw new LineError('not_found', '没有这条线。', '刷新线列表后再试。');
    }
    return line;
  }

  view(lineId: string): LineView {
    const line = this.line(lineId);
    return lineView(this.#state, line, this.#runners.get(line.id)?.activity() ?? NO_ACTIVITY);
  }

  /** 线现在的状态；没有这条线是 null（network/ 收尾替人答话的线用）。 */
  status(lineId: string): LineStatus | null {
    return this.#state.lines.get(lineId)?.status ?? null;
  }

  /** 线这会儿在做的那一步（跨用户任务卡上「在核对营业时间…」）；不在跑是 null。 */
  activity(lineId: string): { text: string; since: string } | null {
    const line = this.#state.lines.get(lineId);
    if (line === undefined) {
      return null;
    }
    const view = this.view(line.id);
    return view.activity === null || view.activeSince === null ? null
      : { text: view.activity, since: view.activeSince };
  }

  list(filter: { kind?: LineView['kind']; statuses?: readonly LineStatus[]; includeArchived?: boolean; limit: number })
    : LineView[] {
    this.#state.lines.main();
    return this.#state.lines.list(filter).map((line) => this.view(line.id));
  }

  read(lineId: string, limit: number, before: number | null = null)
    : { line: LineView; messages: LineMessageView[]; hasMore: boolean; queue: QueuedMessageView[] } {
    const line = this.line(lineId);
    const page = this.#state.lineMessages.page(line.id, before, limit);
    return {
      line: this.view(line.id),
      messages: pageMessages(page.rows, this.#host.sayOf),
      hasMore: page.hasMore,
      queue: this.#state.lineQueue.queued(line.id).map(queuedView),
    };
  }

  // —— 写 ——

  /** 线空闲：这句话开一轮。线在跑（或在等、暂停、后台线已满）：进排队，这一轮结束后按顺序发出。 */
  send(lineId: string, input: SendInput, after: After = NOW): SendResult {
    let line = this.#unarchived(lineId);
    const attachments = [...(input.attachments ?? [])];
    const origin = input.origin ?? { kind: 'user' as const, userText: input.text };
    const notes = this.#notes(attachments, true);
    const title = retitled(line, input.text);
    if (title !== null) {
      line = this.#state.lines.update(line.id, { title });
    }
    if (input.replyTo !== undefined) {
      input = { ...input, text: `${replyMarker(replyFor(this.#state, line.id, input.replyTo))}${input.text}` };
    }
    if (this.#busy(line)) {
      const item = this.#state.lineQueue.add(line.id, input.text, attachments, origin);
      if (line.status === 'idle' && line.kind === 'background') {
        this.#state.lines.update(line.id, { status: 'queued' });
      }
      after(() => this.#publishQueue(line.id));
      return { outcome: 'queued', line: this.view(line.id), message: null, queued: queuedView(item) };
    }
    const message = userMessage(input.text, notes, this.#now().getTime());
    const row = this.#state.transaction(() => {
      const appended = this.#state.lineMessages.append(line.id, 'user', message, { origin });
      this.#state.lines.update(line.id, { status: 'running', failure: null, pausedUntil: null, pauseReason: null });
      return appended;
    });
    const view = messageView(row, this.#host.sayOf);
    after(() => {
      this.#options.publish({ type: 'line_message', message: view });
      this.#launch(line.id, 'continue');
    });
    return { outcome: 'started', line: this.view(line.id), message: view, queued: null };
  }

  /** 一条存下的消息改过之后（部件作答写回）：给界面的样子，提交后推给界面。 */
  touched(lineId: string, seq: number, after: After = NOW): LineMessageView {
    const row = this.#state.lineMessages.get(lineId, seq);
    if (row === undefined) {
      throw new LineError('not_found', '这条消息已经不在了。');
    }
    const view = messageView(row, this.#host.sayOf);
    after(() => this.#options.publish({ type: 'line_message', message: view }));
    return view;
  }

  withdraw(lineId: string, queueId: string, after: After = NOW): { line: LineView; item: QueuedMessageView } {
    const line = this.line(lineId);
    const item = this.#queued(line, queueId, true);
    // 交给 pi 的那条要是已经被这一轮取走（只是还没写进库），就撤不回了：照实说，不记成撤回。
    if (this.#runners.get(line.id)?.unhand(item.id) === 'taken') {
      throw new LineError('conflict', '这条已经发出了，撤不回。');
    }
    const withdrawn = this.#state.lineQueue.withdraw(item.id);
    if (this.#emptyQueued(line.id)) {
      this.#state.lines.update(line.id, { status: 'idle' });
    }
    after(() => this.#publishQueue(line.id));
    return { line: this.view(line.id), item: queuedView(withdrawn) };
  }

  /** 立即发送：线在跑就插进这一轮（steer）；线空着就用这一条开一轮。 */
  sendNow(lineId: string, queueId: string, after: After = NOW): { line: LineView; item: QueuedMessageView } {
    const line = this.#unarchived(lineId);
    const item = this.#queued(line, queueId);
    const runner = this.#runners.get(line.id);
    if (runner?.busy() === true) {
      const inserted = this.#state.lineQueue.insert(item.id);
      after(() => {
        runner.steer(inserted);
        this.#publishQueue(line.id);
      });
      return { line: this.view(line.id), item: queuedView(inserted) };
    }
    this.#cancelTimer(line.id);
    const sent = this.#state.transaction(() => this.#appendQueued(line.id, [item]));
    after(() => this.#launched(line.id, sent));
    return { line: this.view(line.id), item: queuedView(this.#state.lineQueue.get(item.id) ?? item) };
  }

  /** 暂停：先持久化用户意图，再中止这一轮；队列保留，重启或新消息都不自动解除。 */
  halt(lineId: string, after: After = NOW): LineView {
    const line = this.line(lineId);
    this.#cancelTimer(line.id);
    this.#state.lines.update(line.id, { status: 'paused', pauseReason: 'user', pausedUntil: null, failure: null });
    const runner = this.#runners.get(line.id);
    after(() => {
      this.#publishLine(line.id);
      runner?.abort('user');
    });
    return this.view(line.id);
  }

  /** 重试：失败或暂停的线从库里接着跑（停在一组工具中间的先补上）。 */
  retry(lineId: string, after: After = NOW): LineView {
    const line = this.#unarchived(lineId);
    if (line.status !== 'failed' && line.status !== 'paused') {
      throw new LineError('conflict', '这条线没有失败，也没有暂停，不用重试。');
    }
    if (this.#runners.get(line.id)?.busy() === true) {
      throw new LineError('conflict', '这条线正在停下，稍后再继续。');
    }
    this.#cancelTimer(line.id);
    if (line.pauseReason === 'output_limit' && this.#state.lineQueue.queued(line.id).length === 0) {
      const last = this.#state.lineMessages.last(line.id, 'assistant');
      const ref = last !== undefined && isAssistant(last.message) && last.message.stopReason === 'length'
        ? `line:${line.id}:${last.seq}` : undefined;
      this.#state.lineQueue.add(line.id, '接着完成上一段未写完的回答。保留已完成的内容，接着往下写。', [],
        { kind: 'system', ...(ref === undefined ? {} : { ref }) });
    }
    this.#state.lines.update(line.id, { status: 'queued', pauseReason: null, pausedUntil: null, failure: null });
    after(() => {
      this.#publishLine(line.id);
      this.#launch(line.id, 'resume');
    });
    return this.view(line.id);
  }

  /** 已停下的工作可逆归档；不在归档过程中执行或中断其他工作。 */
  archive(lineId: string, after: After = NOW): LineView {
    const line = this.line(lineId);
    if (line.kind === 'main') throw new LineError('conflict', '主对话不能归档。');
    if (line.archivedAt !== null) return this.view(line.id);
    if (this.#runners.get(line.id)?.busy() === true || !['paused', 'idle', 'failed'].includes(line.status)) {
      throw new LineError('conflict', '请先暂停这条工作，等停下后再归档。');
    }
    this.#state.transaction(() => {
      for (const item of this.#state.lineQueue.queued(line.id)) this.#state.lineQueue.withdraw(item.id);
      this.#state.lines.update(line.id, { archivedAt: this.#now().toISOString(), status: 'paused',
        pauseReason: 'user', pausedUntil: null });
    });
    after(() => {
      this.#cancelTimer(line.id);
      this.#publishQueue(line.id);
    });
    return this.view(line.id);
  }

  /** 恢复只让工作重新可见，撤回输入不复活，仍需明确继续。 */
  restore(lineId: string, after: After = NOW): LineView {
    const line = this.line(lineId);
    if (line.archivedAt === null) return this.view(line.id);
    this.#state.lines.update(line.id, { archivedAt: null, status: 'paused', pauseReason: 'user', pausedUntil: null });
    after(() => this.#publishLine(line.id));
    return this.view(line.id);
  }

  #unarchived(lineId: string): LineRow {
    const line = this.line(lineId);
    if (line.archivedAt !== null) throw new LineError('conflict', '这条工作已归档，请先恢复再继续。');
    return line;
  }

  // —— 旁聊、第二栏、表情（《优化清单》第 17 条） ——

  /** 开一条旁聊（他自己开、信息流「讨论」、Plasticine 提议挪过去）：空闲着，等他说第一句。 */
  openSide(input: { title: string; topic: LineTopic | null }, after: After = NOW): LineView {
    const line = this.#state.lines.create({ kind: 'side', parentLineId: null, projectId: null, title: input.title,
      topic: input.topic });
    after(() => this.#publishLine(line.id));
    return this.view(line.id);
  }

  /** 第二栏：主线置顶带最新一行状态，下面是旁聊（最近动过的在前）。 */
  chats(): ChatsResponse {
    const main = this.view(this.#state.lines.main().id);
    const background = this.list({ kind: 'background', statuses: ['running'], limit: SIDES_LIMIT });
    return chats(main, background, this.list({ kind: 'side', limit: SIDES_LIMIT }));
  }

  /** 给一条消息加上或拿掉一个表情；提交后推给界面。 */
  react(lineId: string, input: { seq: number; emoji: string; on: boolean }, after: After = NOW): LineMessageView {
    const line = this.line(lineId);
    toggleReaction(this.#state, line.id, input.seq, input.emoji, input.on);
    return this.touched(line.id, input.seq, after);
  }

  // —— 线的工具用的（LineControl） ——

  spawn(parentLineId: string, input: { title: string; goal: string; projectId: string | null;
    resumeParent?: boolean }, toolCallId?: string): LineView {
    const parent = this.#unarchived(parentLineId);
    const source = this.#state.lineMessages.last(parent.id, 'assistant');
    const matches = toolCallId !== undefined && isAssistant(source?.message)
      && source.message.content.some((part) => part.type === 'toolCall'
        && part.id === toolCallId && part.name === 'start_line');
    const origin = matches && source !== undefined
      ? { kind: 'delegation' as const, ref: lineRef(parent.id, source.seq) } : { kind: 'delegation' as const };
    return this.open({ ...input, parentLineId: parent.id, origin });
  }

  /**
   * 开一条后台线（线的工具、规则触发、别人发来的任务）：建线、把要做什么排进它的队，有空位就开跑。写库是同步的，
   * 可以放进外面的事务；推事件、开跑放在 after。
   */
  open(input: OpenLine, after: After = NOW): LineView {
    if (input.parentLineId !== null) this.#unarchived(input.parentLineId);
    if (input.projectId !== null && this.#state.projects.get(input.projectId) === undefined) {
      throw new LineError('invalid', `没有这个项目：${input.projectId}。`, '先用 list_projects 查项目 id。');
    }
    const line = this.#state.transaction(() => {
      const created = this.#state.lines.create({ kind: 'background', parentLineId: input.parentLineId,
        projectId: input.projectId, title: input.title, sealedPrompt: input.sealedPrompt ?? null,
        resumeParent: input.resumeParent ?? false, modelPurpose: input.purpose ?? null });
      this.#state.lineQueue.add(created.id, input.goal, [], input.origin ?? { kind: 'delegation' });
      return this.#state.lines.update(created.id, { status: 'queued' });
    });
    after(() => {
      this.#publishLine(line.id);
      this.#schedule();
    });
    return this.view(line.id);
  }

  /**
   * 一条后台线做完了没有：停在空闲、没有失败、最后一条是回答（不是工具调用中途），就是它最后那段话；不然 null。
   * 跨用户任务拿它当交付正文（network/）。
   */
  /**
   * 系统通知发在主线上（《优化清单》第 12 条）：主线空着就写库并推给界面（不开一轮），正在跑就插进这一轮。
   * 同一件只发一次由调用方按 key 记回执；这里只管放上去。主线正在跑时返回 null（这一轮写库时才推出去）。
   */
  notice(input: { key: string; text: string; brief: string }): LineMessageView | null {
    const main = this.#state.lines.main();
    const message: LineNoticeMessage = { role: 'notice', key: input.key, text: input.text, brief: input.brief,
      timestamp: this.#now().getTime() };
    return this.#post(main.id, message);
  }

  /**
   * 欢迎（2026-11-08《首次使用流程》）：建账号成功时在主线上放 Plasticine 的招呼，固定文案、不开一轮。和通知一样，
   * 主线正在跑时插进这一轮并返回 null。
   */
  welcome(input: { text: string; starts: WelcomeStart[] }): LineMessageView | null {
    const main = this.#state.lines.main();
    const message: LineWelcomeMessage = { role: 'welcome', text: input.text, starts: input.starts,
      timestamp: this.#now().getTime() };
    return this.#post(main.id, message);
  }

  /**
   * 来信（第 8 批第 6 条）：个人回顾写成来信后在主线放 Plasticine 的一句话和来信卡，不开一轮。和通知一样，主线正在跑
   * 时插进这一轮并返回 null。同一封只发一次由调用方按 key 记回执。
   */
  letter(input: { key: string; text: string; spaceId: string; title: string }): LineMessageView | null {
    const main = this.#state.lines.main();
    const message: LineLetterMessage = { role: 'letter', key: input.key, text: input.text, spaceId: input.spaceId,
      title: input.title, timestamp: this.#now().getTime() };
    return this.#post(main.id, message);
  }

  answer(lineId: string): string | null {
    const line = this.#state.lines.get(lineId);
    if (line === undefined || this.#runners.get(line.id)?.busy() === true || this.view(line.id).outcome !== 'done') {
      return null;
    }
    const last = this.#state.lineMessages.last(line.id, 'assistant')?.message;
    if (!isAssistant(last) || last.stopReason !== 'stop') {
      return null;
    }
    return lineResult(this.#state, line.id);
  }

  tell(lineId: string, text: string): { line: LineView; outcome: 'steered' | 'started' | 'queued' } {
    const line = this.#unarchived(lineId);
    const runner = this.#runners.get(line.id);
    if (runner?.busy() === true) {
      const item = this.#state.lineQueue.add(line.id, text, [], { kind: 'delegation' });
      runner.steer(item);
      this.#publishQueue(line.id);
      return { line: this.view(line.id), outcome: 'steered' };
    }
    const sent = this.send(line.id, { text, origin: { kind: 'delegation' } });
    return { line: sent.line, outcome: sent.outcome };
  }

  // —— 内部 ——

  #runner(lineId: string): LineRunner {
    let runner = this.#runners.get(lineId);
    if (runner === undefined) {
      runner = new LineRunner(this.#host, this.#state.lines.require(lineId));
      this.#runners.set(lineId, runner);
    }
    return runner;
  }

  #launch(lineId: string, mode: DriveMode): boolean {
    if (this.#stopping || this.#runners.get(lineId)?.busy() === true) {
      return false;
    }
    const line = this.#state.lines.require(lineId);
    if (line.archivedAt !== null) return false;
    if (line.status === 'paused' && (line.pauseReason === 'user' || line.pauseReason === 'output_limit')) {
      return false;
    }
    if (line.kind === 'background' && this.#activeBackground() >= this.#max) {
      this.#setStatus(lineId, 'queued', { pauseReason: null, pausedUntil: null });
      return false;
    }
    if (mode === 'continue') {
      // 主线和旁聊换了一天：新开的这一轮从今天起（day-context.ts）；接着跑的那一轮不切。
      rollDay(this.#state, line, this.#now(), this.#zone());
    }
    return this.#runner(lineId).start(mode);
  }

  #launched(lineId: string, sent: readonly LineMessageView[]): void {
    for (const message of sent) {
      this.#options.publish({ type: 'line_message', message });
    }
    this.#publishQueue(lineId);
    this.#launch(lineId, 'continue');
  }

  /** 在跑、在等、暂停的线，和后台线已满时还没开跑的后台线：新消息进排队。 */
  #busy(line: LineRow): boolean {
    if (this.#runners.get(line.id)?.busy() === true) {
      return true;
    }
    if (['queued', 'running', 'waiting', 'paused'].includes(line.status)) {
      return true;
    }
    return line.kind === 'background' && this.#activeBackground(line.id) >= this.#max;
  }

  #activeBackground(except?: string): number {
    let count = 0;
    for (const [lineId, runner] of this.#runners) {
      if (lineId !== except && runner.busy() && this.#state.lines.get(lineId)?.kind === 'background') {
        count += 1;
      }
    }
    return count;
  }

  #queued(line: LineRow, queueId: string, allowInserted = false): QueuedRow {
    const item = this.#state.lineQueue.get(queueId);
    if (item === undefined || item.lineId !== line.id) {
      throw new LineError('not_found', '这条线上没有这条排队的消息。');
    }
    if (item.status === 'inserted' && !allowInserted) {
      throw new LineError('conflict', '这条已经交给这一轮了，这一步做完就插进去。');
    }
    if (item.status !== 'queued' && item.status !== 'inserted') {
      throw new LineError('conflict', item.status === 'sent' ? '这条已经发出了，撤不回。' : '这条已经撤回了。');
    }
    return item;
  }

  #notes(ids: readonly string[], strict = false): AttachmentNote[] {
    return ids.flatMap((id) => {
      const attachment = this.#state.attachments.get(id);
      if (attachment === null) {
        if (strict) {
          throw new LineError('invalid', '没有这份附件。', '重新上传后再发。');
        }
        return [];
      }
      if (strict && attachment.status !== 'ready') {
        throw new LineError('conflict', '附件还没就绪（或者没读成），这条消息没有发送。', '等它读好，或者重新上传。');
      }
      return [{ id, name: attachment.name }];
    });
  }

  /** 排队的这些按顺序写成用户消息、记成发出（同一个事务里）；返回写下的消息。 */
  #appendQueued(lineId: string, items: readonly QueuedRow[]): LineMessageView[] {
    const views = items.map((item) => {
      const message = userMessage(item.text, this.#notes(item.attachments), this.#now().getTime());
      const row = this.#state.lineMessages.append(lineId, 'user', message, { origin: item.origin });
      this.#state.lineQueue.sent(item.id, row.seq);
      return messageView(row, this.#host.sayOf);
    });
    this.#state.lines.update(lineId, { status: 'running', failure: null, pausedUntil: null, pauseReason: null });
    return views;
  }

  /** 把这条线排着的消息一起发出去开一轮；没有排着的就不动。 */
  #pump(lineId: string): boolean {
    const items = this.#state.lineQueue.queued(lineId);
    const line = this.#state.lines.require(lineId);
    if (line.archivedAt !== null) return false;
    if (items.length === 0 || this.#runners.get(lineId)?.busy() === true || this.#stopping) {
      return false;
    }
    if (line.status === 'paused' || line.status === 'failed' || line.status === 'waiting') {
      return false;
    }
    if (line.kind === 'background' && this.#activeBackground() >= this.#max) {
      this.#setStatus(lineId, 'queued');
      return false;
    }
    const sent = this.#state.transaction(() => this.#appendQueued(lineId, items));
    this.#launched(lineId, sent);
    return true;
  }

  /** 后台线有空位就接上排着队的。 */
  #schedule(): void {
    const candidates = new Set([...this.#state.lines.withStatus(['queued']).reverse().map((line) => line.id),
      ...this.#state.lineQueue.linesWithQueued()]);
    for (const lineId of candidates) {
      if (this.#activeBackground() >= this.#max) {
        return;
      }
      const line = this.#state.lines.get(lineId);
      if (line?.kind !== 'background' || line.archivedAt !== null
        || (line.status !== 'idle' && line.status !== 'queued')) {
        continue;
      }
      if (this.#emptyQueued(line.id)) {
        this.#setStatus(line.id, 'idle');
        continue;
      }
      const last = this.#state.lineMessages.last(line.id)?.message;
      if (line.status === 'idle' || last === undefined || (isAssistant(last) && last.stopReason === 'stop')) {
        this.#pump(line.id);
      } else {
        this.#launch(line.id, 'resume');
      }
    }
  }

  /** 最后一条新要求被撤回，且上一轮已完成：不留一个再也启动不了的空排队状态。 */
  #emptyQueued(lineId: string): boolean {
    if (this.#state.lines.require(lineId).status !== 'queued' || this.#state.lineQueue.queued(lineId).length > 0) {
      return false;
    }
    const last = this.#state.lineMessages.last(lineId)?.message;
    return last === undefined || (isAssistant(last) && last.stopReason === 'stop');
  }

  #setStatus(lineId: string, status: LineStatus, patch: LinePatch = {}): void {
    this.#state.lines.update(lineId, { status, ...patch });
    this.#publishLine(lineId);
  }

  #publishLine(lineId: string): void {
    this.#options.publish({ type: 'line_changed', line: this.view(lineId) });
  }

  #publishQueue(lineId: string): void {
    this.#options.publish({ type: 'line_queue', lineId, queue: this.#state.lineQueue.queued(lineId).map(queuedView) });
    this.#publishLine(lineId);
  }

  #waiting(lineId: string, on: boolean): void {
    const line = this.#state.lines.get(lineId);
    if (line === undefined) {
      return;
    }
    if (on && line.status !== 'waiting') {
      this.#setStatus(lineId, 'waiting');
    } else if (!on && line.status === 'waiting') {
      this.#setStatus(lineId, 'running');
    }
  }

  /** 卡答了：有人在等就放开它；没人等（重启前出的卡）就从库里接着跑这条线。 */
  #answered(ask: Ask): void {
    if (this.#waits.notify(ask.id)) {
      return;
    }
    const lineId = ask.context?.['lineId'];
    const line = typeof lineId === 'string' ? this.#state.lines.get(lineId) : undefined;
    if (line?.status === 'waiting' && this.#runners.get(line.id)?.busy() !== true) {
      this.#launch(line.id, 'resume');
    }
  }

  #zone(): string {
    return this.#options.zone?.() ?? this.#options.timeZone ?? DEFAULT_TIME_ZONE;
  }

  #cancelTimer(lineId: string): void {
    this.#timers.get(lineId)?.();
    this.#timers.delete(lineId);
  }

  #ended(lineId: string, outcome: DriveOutcome): void {
    try {
      const line = this.#state.lines.require(lineId);
      if (outcome === 'paused') {
        this.#schedulePause(line);
      }
      if (line.kind === 'background' && (outcome === 'done' || outcome === 'failed')) {
        this.#report(line, outcome);
      }
      if (outcome === 'done') {
        this.#pump(line.id);
      }
      this.#schedule();
    } catch (error) {
      safeLog('error', 'line_after_failed', { category: errorCategory(error) });
    }
    try {
      const line = this.#state.lines.get(lineId);
      if (line !== undefined) {
        this.#options.turnEnded?.(line, outcome);
      }
    } catch (error) {
      safeLog('error', 'line_turn_hook_failed', { category: errorCategory(error) });
    }
  }

  #schedulePause(line: LineRow): void {
    this.#cancelTimer(line.id);
    if (line.archivedAt !== null || line.pauseReason === 'user' || line.pauseReason === 'output_limit') {
      return;
    }
    const until = line.pausedUntil === null ? this.#now().getTime() : Date.parse(line.pausedUntil);
    const wait = Math.max(0, until - this.#now().getTime());
    this.#timers.set(line.id, this.#later(wait, () => {
      this.#timers.delete(line.id);
      if (this.#state.lines.get(line.id)?.status === 'paused') {
        this.#launch(line.id, 'resume');
      }
    }));
    // 只通知一次：同一次额度用完，到点接着跑又撞上，不再贴第二次（做成一轮后清掉）。
    if (line.pauseNoticedAt === null) {
      this.#state.lines.update(line.id, { pauseNoticedAt: this.#now().toISOString() });
      if (line.kind === 'background') {
        this.#report(line, 'paused', pauseNotice(new Date(until), this.#options.timeZone ?? DEFAULT_TIME_ZONE));
      }
    }
  }

  /** 后台线贴回发起它的线：做完了是最后那段话，没做完是原因。 */
  #report(line: LineRow, outcome: ReportOutcome, notice?: string): void {
    if (line.parentLineId === null) {
      return;
    }
    const parent = this.#state.lines.get(line.parentLineId);
    if (parent === undefined) {
      return;
    }
    const report = lineReport(this.#state, line, outcome, this.#now(), notice);
    try {
      this.#options.reported?.(report, parent);
    } catch (error) {
      safeLog('error', 'line_report_hook_failed', { category: errorCategory(error) });
    }
    if (this.#post(parent.id, report) === null) {
      return;
    }
    if (line.resumeParent && (outcome === 'done' || outcome === 'failed') && parent.status === 'idle') {
      this.#launch(parent.id, 'continue');
    }
  }

  /** 贴一条不开一轮的消息：线在跑就交给这一轮（返回 null），空着就写库、推给界面。 */
  #post(lineId: string, message: PostedMessage): LineMessageView | null {
    const runner = this.#runners.get(lineId);
    if (runner?.busy() === true) {
      runner.deliver(message);
      return null;
    }
    const row = this.#state.lineMessages.append(lineId, message.role, message);
    const view = messageView(row, this.#host.sayOf);
    this.#options.publish({ type: 'line_message', message: view });
    this.#publishLine(lineId);
    return view;
  }
}
