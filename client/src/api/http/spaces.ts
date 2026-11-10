// 空间与订阅的真实现（第 6、7 条）：按 shared/api/spaces.ts 的路径发请求、按同一份 schema 校验回答。

import type { LibraryApi, SpacesApi, SubscriptionsApi } from '../spaces-client.ts';
import { Type } from 'typebox';
import { ApiError } from '../errors.ts';
import {
  LIBRARY_TRASH_PATH,
  LibraryTrashResponseSchema,
  REVIEW_PATH,
  ReviewSummarySchema,
  RunSubscriptionResponseSchema,
  SPACE_LIST_STANDALONE_PARAM,
  SPACES_PATH,
  SpaceListResponseSchema,
  SpaceViewSchema,
  SpaceVersionsResponseSchema,
  SUBSCRIPTIONS_PATH,
  SubscriptionListResponseSchema,
  SubscriptionViewSchema,
} from '../shared.ts';
import type { Transport } from './transport.ts';

const spacePath = (id: string): string => `${SPACES_PATH}/${encodeURIComponent(id)}`;
const subscriptionPath = (id: string): string => `${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}`;

const DeletedSchema = Type.Object({ deleted: Type.Boolean() });
// 网页里能用的插图只在这里（Plasticine 自己的资产，和笔记里的图同一处）。
const ASSET_PREFIX = '/v2/notes/assets/';

/** 插图按原样读回来（同源，带会话 cookie）：沙盒里的页面自己读不了，外面读好再传进去。 */
async function readAsset(path: string, signal?: AbortSignal): Promise<Blob> {
  if (!path.startsWith(ASSET_PREFIX)) {
    throw new ApiError({ kind: 'invalid', code: 'invalid_input', message: '这张图不是 Plasticine 自己的资产。' });
  }
  const response = await fetch(path, { credentials: 'same-origin', ...(signal === undefined ? {} : { signal }) });
  if (!response.ok) {
    throw new ApiError({ kind: response.status === 404 ? 'not_found' : 'failed', code: 'asset_unavailable',
      status: response.status, message: `插图没读到（${response.status}）。` });
  }
  return response.blob();
}

export function createSpacesHttp(transport: Transport):
  { spaces: SpacesApi; subscriptions: SubscriptionsApi; library: LibraryApi } {
  const spaces: SpacesApi = {
    list: (signal, filter) => transport.request({ method: 'GET', path: filter?.standalone === true
      ? `${SPACES_PATH}?${SPACE_LIST_STANDALONE_PARAM}=true` : SPACES_PATH, schema: SpaceListResponseSchema,
    what: '读空间', lostAs: 'failed', signal }),
    remove: async (id, input) => {
      await transport.request({ method: 'DELETE', path: spacePath(id), body: input, schema: DeletedSchema,
        what: '删除空间', lostAs: 'uncertain' });
    },
    restore: (id, input) => transport.request({ method: 'POST', path: `${spacePath(id)}/restore`, body: input,
      schema: SpaceViewSchema, what: '还原空间', lostAs: 'uncertain' }),
    get: (id, signal) => transport.request({ method: 'GET', path: spacePath(id), schema: SpaceViewSchema,
      what: '读这个空间', lostAs: 'failed', signal }),
    versions: (id, version, signal) => transport.request({ method: 'GET',
      path: `${spacePath(id)}/versions${version === undefined ? '' : `?version=${version}`}`,
      schema: SpaceVersionsResponseSchema, what: '读空间版本记录', lostAs: 'failed', signal }),
    save: (id, input) => transport.request({ method: 'PUT', path: spacePath(id), body: input,
      schema: SpaceViewSchema, what: '保存空间', lostAs: 'uncertain' }),
    undo: (id, input) => transport.request({ method: 'POST', path: `${spacePath(id)}/undo`, body: input,
      schema: SpaceViewSchema, what: '撤销', lostAs: 'uncertain' }),
    asset: readAsset,
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
  const library: LibraryApi = {
    trash: (signal) => transport.request({ method: 'GET', path: LIBRARY_TRASH_PATH, schema: LibraryTrashResponseSchema,
      what: '读最近删除', lostAs: 'failed', signal }),
  };
  return { spaces, subscriptions, library };
}
