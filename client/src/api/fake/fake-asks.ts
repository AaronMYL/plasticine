// 假的要你定卡：一次只有一张摊开（current），其余排队；作答、先不、问一句都按 requestId 幂等。
// 作答后推 ask.answered，出卡的那条线由它自己的回调接着（onAnswer）；问一句发进出卡的那条线（没有就主线）。
// 另一台设备答的（answerElsewhere）走同一条路，只是不经这边的接口，这边靠事件收起。

import type { AsksApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import { ASK_INLINE_OPTION_MAX, ASK_KIND_LABELS, ASK_KIND_ORDER, isDeferredStandaloneAsk } from '../shared.ts';
import type {
  AnswerAskRequest,
  AnswerAskResponse,
  AskAboutRequest,
  AskAboutResponse,
  AskListResponse,
  AskView,
  AskFeedbackRequest,
  DeferAskRequest,
  DeferAskResponse,
} from '../types.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';
import type { FakeReceipts } from './receipts.ts';
import type { OutboundCard, OutboundGrantInput } from '../shared.ts';

export type AskSeed = Pick<AskView, 'id' | 'kind' | 'question'> &
  Partial<Pick<AskView, 'channel' | 'detail' | 'options' | 'lineId' | 'createdAt' | 'kindLabel'
    | 'moneyDraftId' | 'restorePreviewId' | 'deviceAction' | 'why' | 'channelReason' | 'collision'
    | 'requiresSignature' | 'basis' | 'rulesOffer' | 'taskCard' | 'networkTaskId' | 'scheduleCard'
    | 'subscriptionCard' | 'outbound' | 'networkReply'>>;

export interface FakeAsksDeps {
  authorize?(card: OutboundCard, selected: OutboundGrantInput, option: string): void;
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  /** 问一句发进出卡的那条线；建好线以后再接上（线和卡互相引用）。 */
  lines: () => FakeLines | null;
  now: () => Date;
}

function closedError(): ApiError {
  return new ApiError({
    kind: 'failed',
    code: 'ask_closed',
    message: '这张卡已经答过或撤回了。',
    next: '看清单里它现在的样子。',
    status: 409,
  });
}

function invalid(message: string, field: string): ApiError {
  return new ApiError({ kind: 'invalid', code: 'invalid_request', message, field, status: 400 });
}

/** 摊开的那张：弹框 / 立刻打断档、没「先不」过的里面，立刻打断优先，其余最早的（真服务端 attention/order.ts）。 */
function spread(ask: AskView): boolean {
  return ask.deferredAt === null && (ask.channel === 'popup' || ask.channel === 'interrupt');
}

function byUrgency(a: AskView, b: AskView): number {
  const urgent = Number(b.channel === 'interrupt') - Number(a.channel === 'interrupt');
  return urgent !== 0 ? urgent : a.createdAt.localeCompare(b.createdAt);
}

function byWaiting(a: AskView, b: AskView): number {
  const later = Number(a.channel === 'next_report') - Number(b.channel === 'next_report');
  if (later !== 0) {
    return later;
  }
  const kind = ASK_KIND_ORDER.indexOf(a.kind) - ASK_KIND_ORDER.indexOf(b.kind);
  return kind !== 0 ? kind : a.createdAt.localeCompare(b.createdAt);
}

export class FakeAsks implements AsksApi {
  async feedback(id: string, input: AskFeedbackRequest): Promise<AskView> {
    this.deps.session.require();
    return this.deps.receipts.run('ask_feedback', input.requestId, `POST /v2/asks/${id}/feedback`, () => {
      const row = this.asks.get(id);
      if (row === undefined || row.status !== 'answered') { throw closedError(); }
      const ask = { ...row, feedback: input.feedback, version: row.version + 1 };
      this.asks.set(id, ask);
      this.deps.bus.emit({ type: 'ask.updated', ask });
      return ask;
    });
  }
  private readonly asks = new Map<string, AskView>();
  private readonly outcomes = new Map<string, (option: string | undefined, text: string | undefined) => void>();
  private readonly deps: FakeAsksDeps;

  constructor(deps: FakeAsksDeps) {
    this.deps = deps;
  }

  async list(): Promise<AskListResponse> {
    this.deps.session.require();
    return this.board();
  }

  onAnswer(id: string, outcome: (option: string | undefined, text: string | undefined) => void): void {
    this.outcomes.set(id, outcome);
  }

  async get(id: string): Promise<AskView> {
    this.deps.session.require();
    return this.require(id);
  }

  async answer(id: string, input: AnswerAskRequest): Promise<AnswerAskResponse> {
    this.deps.session.requireUser();
    if (this.require(id).moneyDraftId != null || this.require(id).restorePreviewId != null) {
      throw new ApiError({ kind: 'invalid', code: 'confirmation_required', status: 403,
        message: '请在对应的核对卡确认。' });
    }
    const scope = `POST /v2/asks/${id}/answer ${JSON.stringify(input)}`;
    return this.deps.receipts.run('answer', input.requestId, scope, () => {
      const ask = this.require(id);
      if (ask.outbound !== undefined && input.optionId !== undefined) {
        this.deps.authorize?.(ask.outbound, input.outboundGrant ?? ask.outbound.grant, input.optionId);
      }
      return this.answerNow(id, input.optionId, input.text);
    });
  }

  async defer(id: string, input: DeferAskRequest): Promise<DeferAskResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('defer', input.requestId, `POST /v2/asks/${id}/defer`, () => {
      const ask = this.require(id);
      if (ask.status !== 'open') {
        throw closedError();
      }
      const deferred = this.put({ ...ask, deferredAt: this.deps.now().toISOString() });
      this.deps.bus.emit({ type: 'ask.updated', ask: deferred, ...this.eventState() });
      return { ask: deferred };
    });
  }

  async ask(id: string, input: AskAboutRequest): Promise<AskAboutResponse> {
    this.deps.session.require();
    const ask = this.require(id);
    const lines = this.deps.lines();
    const lineId = ask.lineId ?? MAIN_LINE_ID;
    if (lines === null) {
      throw new ApiError({ kind: 'failed', code: 'not_configured', status: 503, message: '线还没装上。' });
    }
    const sent = await lines.send(lineId, { requestId: input.requestId,
      text: `关于「${ask.question}」：${input.text}` });
    return { lineId, outcome: sent.outcome };
  }

  /** 线那一侧：出一张卡。 */
  raise(seed: AskSeed): AskView {
    const options = seed.options ?? [];
    const ask = this.put({
      channel: 'popup',
      detail: null,
      lineId: null,
      createdAt: this.deps.now().toISOString(),
      ...seed,
      kindLabel: seed.kindLabel ?? ASK_KIND_LABELS[seed.kind],
      options,
      layout: options.length > ASK_INLINE_OPTION_MAX || options.some((o) => o.description !== null) ? 'list' : 'inline',
      status: 'open',
      answer: null,
      deferredAt: null,
      answeredAt: null,
      version: 1,
    });
    const current = this.board().current?.id === ask.id;
    this.deps.bus.emit({ type: 'ask.created', ask, current, ...this.eventState() });
    return ask;
  }

  /** 另一台设备答了这张卡：这边的接口没经手，只收得到事件。 */
  answerElsewhere(id: string, optionId?: string, text?: string): AskView {
    return this.answerNow(id, optionId, text).ask;
  }

  answerSigned(id: string, input: AnswerAskRequest): AnswerAskResponse {
    this.deps.session.requireUser();
    if (this.require(id).moneyDraftId != null || this.require(id).restorePreviewId != null) {
      throw new ApiError({ kind: 'invalid', code: 'confirmation_required', status: 403,
        message: '请在对应的核对卡确认。' });
    }
    return this.answerNow(id, input.optionId, input.text);
  }

  touch(id: string): AskView {
    const ask = this.put(this.require(id));
    this.deps.bus.emit({ type: 'ask.updated', ask });
    return ask;
  }

  /** 卡撤回了：推 ask.updated。 */
  withdraw(id: string): AskView {
    const withdrawn = this.put({ ...this.require(id), status: 'withdrawn' });
    this.deps.bus.emit({ type: 'ask.updated', ask: withdrawn, ...this.eventState() });
    return withdrawn;
  }

  /** 与真接口同口径：当前待答的卡。 */
  looseOpenCount(): number {
    const { current, queue } = this.board();
    return [current, ...queue].filter((ask) => ask !== null).length;
  }

  board(): AskListResponse {
    const open = [...this.asks.values()].filter((ask) => ask.status === 'open');
    const deferred = open.filter(isDeferredStandaloneAsk).sort(byWaiting);
    const active = open.filter((ask) => !isDeferredStandaloneAsk(ask));
    const current = active.filter(spread).sort(byUrgency)[0] ?? null;
    const queue = active.filter((ask) => ask.id !== current?.id).sort(byWaiting);
    return { current, queue, deferred };
  }

  private eventState() {
    return { currentId: this.board().current?.id ?? null, waitingOnYouCount: this.looseOpenCount() };
  }

  private require(id: string): AskView {
    const ask = this.asks.get(id);
    if (ask === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这张卡。', status: 404 });
    }
    return ask;
  }

  /** 存一版：版本加一（第一次存就是 1）。 */
  private put(ask: AskView): AskView {
    const previous = this.asks.get(ask.id);
    const stored = previous === undefined ? ask : { ...ask, version: previous.version + 1 };
    this.asks.set(ask.id, stored);
    return stored;
  }

  private answerNow(id: string, optionId: string | undefined, text: string | undefined): AnswerAskResponse {
    const ask = this.require(id);
    if (ask.status !== 'open') {
      throw closedError();
    }
    const option = ask.options.find((candidate) => candidate.id === optionId);
    if (ask.options.length > 0 && option === undefined) {
      throw invalid('这张卡要选一个选项。', 'optionId');
    }
    if (ask.options.length === 0 && (text === undefined || text.trim() === '')) {
      throw invalid('这张卡要写一句。', 'text');
    }
    const label = option?.label ?? text ?? '';
    const answered = this.put({
      ...ask,
      status: 'answered',
      answer: { optionId: option?.id ?? null, label, text: text ?? null },
      answeredAt: this.deps.now().toISOString(),
    });
    this.outcomes.get(id)?.(optionId, text);
    this.deps.bus.emit({ type: 'ask.answered', ask: answered, ...this.eventState() });
    return { ask: answered };
  }
}
