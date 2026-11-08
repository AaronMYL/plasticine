// /v2/subscriptions 与 /v2/review（shared/api/spaces.ts，《优化清单》第 6、7 条）：订阅列表、一个订阅（最新一期 /
// 往期 / 设置）、改设置、开定时 / 暂停、「以后都这样」、现在出一期；首页「回顾」一节。写都按 requestId 幂等、带 version。

import {
  AdoptRuleRequestSchema,
  RunSubscriptionRequestSchema,
  UpdateSubscriptionRequestSchema,
  type SubscriptionListResponse,
} from '../../shared/api/index.ts';
import type { Subscription } from '../../shared/state.ts';
import { LineError, type LineKernel } from '../lines/index.ts';
import { MAIN_LINE_ID, type StateService } from '../state/index.ts';
import { adoptRule, changeSubscription, runSubscription, type RunPort } from '../subs/index.ts';
import { notFoundError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { reviewSummary, subscriptionListItem, subscriptionView } from './space-views.ts';
import { checkInput } from './validate.ts';

function requireSubscription(state: StateService, id: string): Subscription {
  const subscription = state.subscriptions.get(id);
  if (subscription === undefined) {
    throw notFoundError('这个订阅');
  }
  return subscription;
}

/** 订阅往后台线里放消息的那一头：开线、往线里放一条；线不在了（归档、删了）就让 subs/ 另开一条。 */
export function linePort(lines: LineKernel): RunPort {
  return {
    open: (input) => lines.open({ title: input.title, goal: input.goal, projectId: null,
      parentLineId: input.parentLineId, origin: input.origin, purpose: input.purpose }).id,
    tell(lineId, text) {
      try {
        lines.tell(lineId, text);
        return true;
      } catch (error) {
        if (error instanceof LineError && (error.code === 'not_found' || error.code === 'invalid')) {
          return false;
        }
        throw error;
      }
    },
  };
}

/** GET /v2/subscriptions */
export function listSubscriptions(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const body: SubscriptionListResponse = { subscriptions: state.subscriptions.all()
    .map((subscription) => subscriptionListItem(state, subscription)) };
  return { status: 200, body };
}

/** GET /v2/subscriptions/:id */
export function getSubscription(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  return { status: 200,
    body: subscriptionView(state, requireSubscription(state, param(context, 'id')), context.deps.now()) };
}

/** PUT /v2/subscriptions/:id：改设置、开定时（要先出过样刊）、暂停。 */
export async function updateSubscription(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(UpdateSubscriptionRequestSchema, await readJsonBody(context.req), '改订阅');
  const { state } = context.deps;
  const subscription = requireSubscription(state, param(context, 'id'));
  return idempotent(context, body.requestId, () => {
    const changed = changeSubscription(state, subscription.id, body.version, {
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.settings === undefined ? {} : { settings: body.settings }),
      ...(body.status === undefined ? {} : { status: body.status }),
    });
    return { status: 200, body: subscriptionView(state, changed, context.deps.now()) };
  });
}

/** POST /v2/subscriptions/:id/rules：「以后都这样」。 */
export async function adoptSubscriptionRule(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(AdoptRuleRequestSchema, await readJsonBody(context.req), '以后都这样');
  const { state } = context.deps;
  const subscription = requireSubscription(state, param(context, 'id'));
  return idempotent(context, body.requestId, () => {
    const changed = adoptRule(state, subscription.id, body.version, body.spaceId, body.spaceVersion,
      context.deps.now().toISOString());
    return { status: 200, body: subscriptionView(state, changed, context.deps.now()) };
  });
}

/** POST /v2/subscriptions/:id/run：现在出一期（写好贴回主线）。 */
export async function runSubscriptionNow(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(RunSubscriptionRequestSchema, await readJsonBody(context.req), '现在出一期');
  const { state } = context.deps;
  const subscription = requireSubscription(state, param(context, 'id'));
  return idempotent(context, body.requestId, () => {
    const { lineId } = runSubscription(state, linePort(context.deps.lines), subscription.id, context.deps.now(),
      body.edition ?? null, MAIN_LINE_ID);
    return { status: 200, body: { lineId } };
  });
}

/** GET /v2/review：首页「回顾」一节。 */
export function getReviewSummary(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: reviewSummary(context.deps.state, context.deps.now()) };
}
