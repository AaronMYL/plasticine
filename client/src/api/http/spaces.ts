// 空间与订阅的真实现（第 6、7 条）：按 shared/api/spaces.ts 的路径发请求、按同一份 schema 校验回答。

import type { SpacesApi, SubscriptionsApi } from '../spaces-client.ts';
import {
  NoteAssistViewSchema,
  noteAssistTimeoutMs,
  REVIEW_PATH,
  ReviewSummarySchema,
  RunSubscriptionResponseSchema,
  SPACES_PATH,
  SpaceListResponseSchema,
  SpaceViewSchema,
  SUBSCRIPTIONS_PATH,
  SubscriptionListResponseSchema,
  SubscriptionViewSchema,
} from '../shared.ts';
import type { Transport } from './transport.ts';

// 续写给的等待余量（同笔记 http/notes.ts）。
const ASSIST_GRACE_MS = 5000;

const spacePath = (id: string): string => `${SPACES_PATH}/${encodeURIComponent(id)}`;
const subscriptionPath = (id: string): string => `${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}`;

export function createSpacesHttp(transport: Transport): { spaces: SpacesApi; subscriptions: SubscriptionsApi } {
  const spaces: SpacesApi = {
    list: (signal) => transport.request({ method: 'GET', path: SPACES_PATH, schema: SpaceListResponseSchema,
      what: '读空间', lostAs: 'failed', signal }),
    get: (id, signal) => transport.request({ method: 'GET', path: spacePath(id), schema: SpaceViewSchema,
      what: '读这个空间', lostAs: 'failed', signal }),
    save: (id, input) => transport.request({ method: 'PUT', path: spacePath(id), body: input,
      schema: SpaceViewSchema, what: '保存空间', lostAs: 'uncertain' }),
    undo: (id, input) => transport.request({ method: 'POST', path: `${spacePath(id)}/undo`, body: input,
      schema: SpaceViewSchema, what: '撤销', lostAs: 'uncertain' }),
    assist: (id, input, signal) => transport.request({ method: 'POST', path: `${spacePath(id)}/assist`, body: input,
      schema: NoteAssistViewSchema, what: '续写', lostAs: 'failed',
      timeoutMs: noteAssistTimeoutMs(input) + ASSIST_GRACE_MS, signal }),
  };
  const subscriptions: SubscriptionsApi = {
    list: (signal) => transport.request({ method: 'GET', path: SUBSCRIPTIONS_PATH,
      schema: SubscriptionListResponseSchema, what: '读订阅', lostAs: 'failed', signal }),
    get: (id, signal) => transport.request({ method: 'GET', path: subscriptionPath(id),
      schema: SubscriptionViewSchema, what: '读这个订阅', lostAs: 'failed', signal }),
    update: (id, input) => transport.request({ method: 'PUT', path: subscriptionPath(id), body: input,
      schema: SubscriptionViewSchema, what: '保存订阅设置', lostAs: 'uncertain' }),
    adoptRule: (id, input) => transport.request({ method: 'POST', path: `${subscriptionPath(id)}/rules`, body: input,
      schema: SubscriptionViewSchema, what: '以后都这样', lostAs: 'uncertain' }),
    run: (id, input) => transport.request({ method: 'POST', path: `${subscriptionPath(id)}/run`, body: input,
      schema: RunSubscriptionResponseSchema, what: '现在出一期', lostAs: 'uncertain' }),
    review: (signal) => transport.request({ method: 'GET', path: REVIEW_PATH, schema: ReviewSummarySchema,
      what: '读回顾', lostAs: 'failed', signal }),
  };
  return { spaces, subscriptions };
}
