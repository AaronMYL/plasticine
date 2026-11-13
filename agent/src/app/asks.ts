// /v2/asks: 要你定卡——现在摊开的一张和排队的、作答、先不、评价、问一句。作答和它带来的后果（线接着跑、记一笔账……）在
// attention/ 和出卡的那一方里一个事务提交；提交之后才推给各台设备，所以在一处答了，别处同步。
// 2026-11-05 Harness 重做：问一句发进出卡的那条线（不是线上的卡就发进主线），不再写旧对话。

import {
  AnswerAskRequestSchema,
  ASK_INLINE_OPTION_MAX,
  ASK_KIND_LABELS,
  AskAboutRequestSchema,
  AskFeedbackRequestSchema,
  DeferAskRequestSchema,
  ScheduleCardPreviewSchema,
  SubscriptionCardPreviewSchema,
  TaskCardPreviewSchema,
  type AnswerAskResponse,
  type AskAboutResponse,
  type AskListResponse,
  type AskView,
  type DeferAskResponse,
  type ScheduleCardPreview,
  type SubscriptionCardPreview,
  type TaskCardPreview,
} from '../../shared/api/index.ts';
import { Value } from 'typebox/value';
import { OutboundCardSchema } from '../../shared/outbound.ts';
import type { Ask } from '../../shared/state.ts';
import { MAIN_LINE_ID } from '../state/index.ts';
import { ApiError, notFoundError, toApiError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { userConfirmation } from './user-confirmation.ts';
import { readJsonBody, readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

const LINE_RUN_PREFIX = 'line:';

function contextText(ask: Ask, key: string): string | null {
  const value = ask.context?.[key];
  return typeof value === 'string' ? value : null;
}

/** 一张卡 → 界面上的样子。只挑字段和补标签。 */
/** 出这张卡的那条线：线上出的卡在 context 里记着 lineId；更早的只在 runId 里写成 line:<线>。别处出的是 null。 */
export function lineOf(ask: Ask): string | null {
  const fromContext = ask.context?.['lineId'];
  if (typeof fromContext === 'string' && fromContext !== '') {
    return fromContext;
  }
  return ask.runId?.startsWith(LINE_RUN_PREFIX) === true ? ask.runId.slice(LINE_RUN_PREFIX.length) : null;
}

/** 硬线卡上的任务卡样子（发任务卡那件工具交来的 preview）；对不上格式就不画。 */
function taskCardOf(ask: Ask): TaskCardPreview | null {
  const preview = ask.context?.['preview'];
  return Value.Check(TaskCardPreviewSchema, preview) ? preview : null;
}

/** 定时卡的样子（起草定时卡那件工具交来的，tasks/tools.ts）；对不上格式就不画。 */
function scheduleCardOf(ask: Ask): ScheduleCardPreview | null {
  const preview = ask.context?.['schedule'];
  return Value.Check(ScheduleCardPreviewSchema, preview) ? preview : null;
}

/** 样刊附的「开启定时」卡（subs/sample-card.ts）；对不上格式就不画。 */
function subscriptionCardOf(ask: Ask): SubscriptionCardPreview | null {
  const preview = ask.context?.['subscription'];
  return ask.purpose === 'subscription_schedule' && Value.Check(SubscriptionCardPreviewSchema, preview)
    ? preview : null;
}

/** 要我确认怎么回别人的卡属于哪段聊天；别的卡是 null。 */
function networkReplyOf(ask: Ask): NonNullable<AskView['networkReply']> | null {
  const context = ask.context ?? {};
  const questionId = context['questionId'];
  if (ask.purpose !== 'network_reply' || typeof questionId !== 'string') {
    return null;
  }
  const text = (key: string): string | null => (typeof context[key] === 'string' ? context[key] : null);
  return { contactId: text('contactId'), groupId: text('groupId'), questionId, draft: text('draft'),
    ...(context['self'] === true ? { self: true } : {}) };
}

export function askView(_state: unknown, ask: Ask): AskView {
  const longOptions = ask.options.some((option) => option.description !== null);
  const taskCard = taskCardOf(ask);
  const networkReply = networkReplyOf(ask);
  const scheduleCard = scheduleCardOf(ask);
  const subscriptionCard = subscriptionCardOf(ask);
  return {
    id: ask.id,
    ...(Value.Check(OutboundCardSchema, ask.context?.outbound) ? { outbound: ask.context.outbound } : {}),
    ...(ask.purpose === 'network_task' && typeof ask.context?.['networkTaskId'] === 'string'
      ? { networkTaskId: ask.context['networkTaskId'] } : {}),
    ...(networkReply === null ? {} : { networkReply }),
    ...(taskCard === null ? {} : { taskCard }),
    ...(scheduleCard === null ? {} : { scheduleCard }),
    ...(subscriptionCard === null ? {} : { subscriptionCard }),
    feedback: ask.feedback,
    ...(ask.purpose === 'device_action' ? { deviceAction: true } : {}),
    ...(ask.context?.['requiresSignature'] === true ? { requiresSignature: true } : {}),
    why: contextText(ask, 'why') ?? ask.detail ?? ask.question,
    basis: ask.basis,
    channelReason: contextText(ask, 'channelReason') ?? (ask.channel === 'next_report' ? '留在下次汇报，等你方便时处理。'
      : ask.channel === 'interrupt' ? '这件事需要及时处理。' : '当前有一个需要你决定的具体问题。'),
    kind: ask.kind,
    kindLabel: ASK_KIND_LABELS[ask.kind],
    channel: ask.channel,
    question: ask.question,
    detail: ask.detail,
    ...(contextText(ask, 'failure') === null ? {} : { failure: contextText(ask, 'failure') }),
    ...(contextText(ask, 'continuation') === null ? {} : { continuation: contextText(ask, 'continuation') }),
    options: ask.options,
    layout: ask.options.length > ASK_INLINE_OPTION_MAX || longOptions ? 'list' : 'inline',
    status: ask.status,
    answer: ask.answer,
    lineId: lineOf(ask),
    moneyDraftId: ask.purpose === 'money_confirmation' ? contextText(ask, 'moneyDraftId') : null,
    restorePreviewId: ask.purpose === 'backup_restore' ? contextText(ask, 'restorePreviewId') : null,
    createdAt: ask.createdAt,
    deferredAt: ask.deferredAt,
    answeredAt: ask.answeredAt,
    version: ask.version,
  };
}

/** GET /v2/asks */
export function listAsks(context: RequestContext): Reply {
  requireAuth(context);
  const { state, desk } = context.deps;
  const board = desk.board();
  const body: AskListResponse = {
    current: board.current === null ? null : askView(state, board.current),
    queue: board.queue.map((ask) => askView(state, ask)),
    deferred: board.deferred.map((ask) => askView(state, ask)),
  };
  return { status: 200, body };
}

/** GET /v2/asks/:id */
export function getAsk(context: RequestContext): Reply {
  requireAuth(context);
  const ask = context.deps.desk.get(param(context, 'id'));
  if (ask === undefined) {
    throw notFoundError('这张卡');
  }
  return { status: 200, body: askView(context.deps.state, ask) };
}

/** POST /v2/asks/:id/answer */
export async function answerAsk(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(AnswerAskRequestSchema, raw.value, '作答');
  const askId = param(context, 'id');
  const { state, desk } = context.deps;
  const current = desk.get(askId);
  const needsConfirmation = current?.purpose === 'device_action'
    || (current?.context?.['requiresSignature'] === true && body.optionId === 'adopt');
  const confirmation = needsConfirmation
    ? userConfirmation(context) : undefined;
  return idempotent(context, body.requestId, (afterCommit) => {
    if (body.outboundGrant !== undefined) {
      const card = current?.context?.outbound;
      if (current?.purpose !== 'line_approval' || current.status !== 'open'
        || !Value.Check(OutboundCardSchema, card) || body.outboundGrant.actor !== card.grant.actor) {
        throw new ApiError(400, 'invalid_input', '这张卡不能修改这份对外授权。');
      }
      state.asks.update(current.id, current.version,
        { context: { ...current.context, outbound: { ...card, grant: body.outboundGrant } } });
    }
    if (current?.purpose === 'backup_restore') {
      throw new ApiError(403, 'confirmation_required', '请核对备份预览，再确认恢复。');
    }
    if (current?.purpose === 'money_confirmation') {
      throw new ApiError(403, 'confirmation_required', '请在记账卡核对字段，再确认记账。');
    }
    const input = {
      askId,
      answerer: { deviceId: auth.device.id, ...(confirmation === undefined ? {} : { confirmation }) },
      ...(body.optionId === undefined ? {} : { optionId: body.optionId }),
      ...(body.text === undefined ? {} : { text: body.text }),
    };
    const attempt = desk.tryAnswer(input, afterCommit);
    if ('error' in attempt) {
      const { error } = toApiError(attempt.error);
      return { status: error.status, body: error.body() };
    }
    const response: AnswerAskResponse = { ask: askView(state, attempt.answered.ask) };
    return { status: 200, body: response };
  }, confirmation === undefined ? {} : { bodyDigest: raw.digest });
}

/** POST /v2/asks/:id/defer */
export async function deferAsk(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(DeferAskRequestSchema, await readJsonBody(context.req), '先不');
  const askId = param(context, 'id');
  const { state, desk } = context.deps;
  return idempotent(context, body.requestId, (afterCommit) => {
    const response: DeferAskResponse = { ask: askView(state, desk.defer(askId, afterCommit)) };
    return { status: 200, body: response };
  });
}

/** POST /v2/asks/:id/feedback：答完以后说这张卡该不该问。 */
export async function feedbackAsk(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(AskFeedbackRequestSchema, await readJsonBody(context.req), '提问反馈');
  const id = param(context, 'id');
  const { state, desk } = context.deps;
  return idempotent(context, body.requestId, (afterCommit) => {
    const row = state.asks.require(id);
    if (row.status !== 'answered') {
      throw new ApiError(409, 'conflict', '先回答这张卡，再评价该不该问。');
    }
    const ask = desk.commit((changes) => {
      const next = state.asks.update(id, row.version, { feedback: body.feedback,
        feedbackAt: context.deps.now().toISOString() });
      changes.ask(id, 'updated');
      return next;
    }, afterCommit);
    return { status: 200, body: askView(state, ask) };
  });
}

/** POST /v2/asks/:id/ask — 问一句：发进出卡的那条线（引着这张卡），卡照旧开着。 */
export async function askAboutAsk(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(AskAboutRequestSchema, await readJsonBody(context.req), '问一句');
  const askId = param(context, 'id');
  const { desk, lines } = context.deps;
  return idempotent(context, body.requestId, (afterCommit) => {
    const ask = desk.get(askId);
    if (ask === undefined) {
      throw notFoundError('这张卡');
    }
    const fromLine = lineOf(ask);
    const lineId = fromLine !== null && context.deps.state.lines.get(fromLine) !== undefined ? fromLine : MAIN_LINE_ID;
    const sent = lines.send(lineId, { text: `关于「${ask.question}」：${body.text}`,
      origin: auth.actor === 'system' ? { kind: 'system', ref: auth.device.id }
        : { kind: 'user', userText: body.text } }, afterCommit);
    const response: AskAboutResponse = { lineId, outcome: sent.outcome };
    return { status: 202, body: response };
  });
}
