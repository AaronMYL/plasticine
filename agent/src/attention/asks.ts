// 要你定卡的一生（《UI 方案》第 6 节）：出卡（同一个动作只出一张）→ 摊开或排队（按渠道，channels.ts）→ 作答 / 先不 /
// 撤回。卡被答和它带来的后果（线接着跑、记一笔账……由注入的 AskResolver 做）在同一个事务里提交，提交之后才推给各台
// 设备——所以一张卡在一处被答，别处同步看到。2026-11-05 Harness 重做：作答不再写一条「选择：…」进旧对话，线上的卡
// 由新内核自己把答案交回那条线。

import { isDeferredStandaloneAsk } from '../../shared/api/asks.ts';
import { ASK_PURPOSE_LINES, type Ask, type AskAnswer, type AskBasis, type AskInput, type AskKind, type AskOption,
  type AskPurpose, type DeviceConfirmation } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { Changes } from './changes.ts';
import { channelForAsk, type AskChannel } from './channels.ts';
import { AttentionError } from './errors.ts';
import { compareAsks, currentAsk } from './order.ts';
import type { Presenter } from './presenter.ts';

export interface AskOptionInput {
  id: string;
  label: string;
  recommended?: boolean;
  description?: string | null;
}

export interface RaiseAsk {
  kind: AskKind;
  purpose: AskPurpose;
  question: string;
  options: AskOptionInput[];
  detail?: string | null;
  taskId?: string | null;
  runId?: string | null;
  actionId?: string | null;
  context?: Record<string, unknown> | null;
  /** The channel the requester asks for; channels.ts has the last word. */
  channel?: AskChannel;
  /** 为什么问（shared/act-or-ask.ts）；不写就按 ASK_PURPOSE_LINES 里这种卡的默认。硬线的卡只能是硬线。 */
  basis?: AskBasis;
}

/** Who answered, and the request that carried it. */
export interface Answerer {
  deviceId: string;
  confirmation?: DeviceConfirmation;
}

/** What answering a card sets off, run inside the same transaction as the answer. */
export interface AskResolver {
  /** 暂缓只释放可继续对话的等待，不产生用户答案或授权。 */
  deferred?(changes: Changes, ask: Ask): void;
  /** An obsolete condition withdraws the card before any answer is written. */
  validate?(ask: Ask, at: string): AttentionError | undefined;
  resolve(changes: Changes, ask: Ask, answerer: Answerer, at: string): void;
}

export interface AnswerInput {
  askId: string;
  optionId?: string;
  text?: string;
  answerer: Answerer;
}

export interface AnsweredAsk {
  ask: Ask;
}

export type AnswerAttempt = { answered: AnsweredAsk } | { error: AttentionError };

export type AskDeskState = Pick<StateService, 'asks' | 'transaction'>;

/** Schedules an action for after the outer transaction has committed (app/idempotency.ts). */
export type AfterCommit = (action: () => void) => void;

/** 推荐项放第一个，最多一个（第 38 条、用户的规矩「推荐项放第一」）。 */
function orderedOptions(options: readonly AskOptionInput[]): AskOption[] {
  const recommended = options.filter((option) => option.recommended === true);
  if (recommended.length > 1) {
    throw new AttentionError('invalid_ask', '一张卡最多一个推荐项。');
  }
  const ids = new Set(options.map((option) => option.id));
  if (ids.size !== options.length) {
    throw new AttentionError('invalid_ask', '卡上的选项 id 不能重复。');
  }
  const sorted = [...recommended, ...options.filter((option) => option.recommended !== true)];
  return sorted.map((option) => ({
    id: option.id,
    label: option.label,
    recommended: option.recommended === true,
    description: option.description ?? null,
  }));
}

/** 第 5 批「做还是问」：硬线的卡谁出都是硬线；看把握的卡记出卡的人写的依据，没写用这种卡的默认。 */
function basisOf(input: RaiseAsk): AskBasis {
  const { line, basis } = ASK_PURPOSE_LINES[input.purpose];
  if (line === 'hard_line' && input.basis !== undefined && input.basis !== 'hard_line') {
    throw new AttentionError('invalid_ask', '这种卡是硬线（花钱、对外、撤不回、权限、要你本人做），依据只能是硬线。');
  }
  return input.basis ?? basis;
}

function answerOf(ask: Ask, optionId: string | undefined, text: string | undefined): AskAnswer {
  if (ask.options.length === 0) {
    if (text === undefined || text.trim() === '') {
      throw new AttentionError('invalid_answer', '这张卡要写一句话回答。', 'text');
    }
    return { optionId: null, label: text, text };
  }
  const option = ask.options.find((candidate) => candidate.id === optionId);
  if (option === undefined) {
    const known = ask.options.map((candidate) => candidate.label).join('、');
    throw new AttentionError('invalid_answer', `这张卡的选项是：${known}；没有你选的那一个。`, 'optionId');
  }
  return { optionId: option.id, label: option.label, text: text ?? null };
}

export class AskDesk {
  readonly #state: AskDeskState;
  readonly #presenter: Presenter;
  readonly #now: () => Date;
  #resolver: AskResolver | undefined;

  constructor(options: { state: AskDeskState; presenter: Presenter; now?: () => Date }) {
    this.#state = options.state;
    this.#presenter = options.presenter;
    this.#now = options.now ?? (() => new Date());
  }

  /** app/ registers what answers set off; set once at start-up, before any card can be answered. */
  setResolver(resolver: AskResolver): void {
    this.#resolver = resolver;
  }

  /**
   * Runs `work` in one transaction and presents what it changed once it has committed. Inside an outer transaction
   * (an API request whose answer is stored with it), pass `after` so the presentation waits for that commit too.
   */
  commit<T>(work: (changes: Changes) => T, after?: AfterCommit): T {
    const changes = new Changes();
    const result = this.#state.transaction(() => work(changes));
    const present = (): void => this.#presenter.present(changes);
    if (after === undefined) {
      present();
    } else {
      after(present);
    }
    return result;
  }

  /** Raises a card inside the caller's transaction; the same action id returns the card it raised before. */
  raise(changes: Changes, input: RaiseAsk): Ask {
    const actionId = input.actionId ?? null;
    if (actionId !== null) {
      const existing = this.#state.asks.byActionId(actionId);
      if (existing !== undefined) {
        return existing;
      }
    }
    const draft: AskInput = {
      kind: input.kind,
      purpose: input.purpose,
      channel: channelForAsk(input.purpose, input.channel),
      question: input.question,
      detail: input.detail ?? null,
      options: orderedOptions(input.options),
      taskId: input.taskId ?? null,
      runId: input.runId ?? null,
      actionId,
      context: input.context ?? null,
      basis: basisOf(input),
    };
    const ask = this.#state.asks.create(draft);
    changes.ask(ask.id, 'created');
    return ask;
  }

  /** Answers inside the caller's transaction (a restore that answers its card). */
  answerWithin(changes: Changes, input: AnswerInput): AnsweredAsk {
    const ask = this.#state.asks.get(input.askId);
    if (ask === undefined) {
      throw new AttentionError('not_found', '没有这张卡。');
    }
    if (ask.status !== 'open') {
      const what = ask.status === 'answered' ? '已经答过了' : '已经撤回了（提问条件已改变）';
      throw new AttentionError('ask_closed', `这张卡${what}。`);
    }
    const at = this.#now().toISOString();
    const invalid = this.#resolver?.validate?.(ask, at);
    if (invalid !== undefined) {
      throw invalid;
    }
    const answer = answerOf(ask, input.optionId, input.text);
    const answered = this.#state.asks.update(ask.id, ask.version, {
      status: 'answered',
      answer,
      answeredAt: at,
      answeredByDeviceId: input.answerer.deviceId,
    });
    changes.ask(ask.id, 'answered');
    this.#resolver?.resolve(changes, answered, input.answerer, at);
    return { ask: answered };
  }

  answer(input: AnswerInput, after?: AfterCommit): AnsweredAsk {
    const attempt = this.tryAnswer(input, after);
    if ('error' in attempt) {
      throw attempt.error;
    }
    return attempt.answered;
  }

  /** A refusal is a result so an outer request transaction can commit the withdrawal together with its 409. */
  tryAnswer(input: AnswerInput, after?: AfterCommit): AnswerAttempt {
    return this.commit((changes) => {
      const ask = this.#state.asks.get(input.askId);
      if (ask?.status === 'open') {
        const at = this.#now().toISOString();
        const error = this.#resolver?.validate?.(ask, at);
        if (error !== undefined) {
          this.#state.asks.update(ask.id, ask.version, { status: 'withdrawn', withdrawnAt: at });
          changes.ask(ask.id, 'updated');
          return { error };
        }
      }
      return { answered: this.answerWithin(changes, input) };
    }, after);
  }

  /** 先不：卡仍开着，移入暂缓区。 */
  defer(askId: string, after?: AfterCommit): Ask {
    return this.commit((changes) => {
      const ask = this.#state.asks.get(askId);
      if (ask === undefined) {
        throw new AttentionError('not_found', '没有这张卡。');
      }
      if (ask.status !== 'open') {
        throw new AttentionError('ask_closed', '这张卡已经不用答了。');
      }
      if (ask.deferredAt !== null) {
        return ask;
      }
      const deferred = this.#state.asks.update(ask.id, ask.version, { deferredAt: this.#now().toISOString() });
      changes.ask(ask.id, 'updated');
      this.#resolver?.deferred?.(changes, deferred);
      return deferred;
    }, after);
  }

  get(askId: string): Ask | undefined {
    return this.#state.asks.get(askId);
  }

  /** 只分展示队列，不改变卡；暂缓的卡不进入任何当前待答计数。 */
  board(): { current: Ask | null; queue: Ask[]; deferred: Ask[] } {
    const open = this.#state.asks.open();
    const deferred = open.filter(isDeferredStandaloneAsk).sort(compareAsks);
    const active = open.filter((ask) => !isDeferredStandaloneAsk(ask));
    const current = currentAsk(active);
    const queue = active.filter((ask) => ask.id !== current?.id).sort(compareAsks);
    return { current, queue, deferred };
  }
}
