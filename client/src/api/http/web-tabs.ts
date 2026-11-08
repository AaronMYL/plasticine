// /v2/web-tabs 和 /v2/favicon 的真实现（11-08）：按 shared/api/web-tabs.ts 的路径发请求、按同一份 schema 校验回答；
// 版本过时服务端回 409 和现在那一份，换成 ConflictError 交给同步（state/web-tabs-sync.ts）。图标是同源的 <img>，
// 带会话 cookie，不经 fetch。

import type { WebTabsApi } from '../web-tabs-client.ts';
import {
  FAVICON_PATH,
  PutFaviconResponseSchema,
  PutWebTabsResponseSchema,
  WEB_TABS_MERGE_PATH,
  WEB_TABS_PATH,
  WebTabsResponseSchema,
  faviconPath,
} from '../shared.ts';
import { conflictWith } from './conflict.ts';
import type { Transport } from './transport.ts';

export function createWebTabsHttp(transport: Transport): WebTabsApi {
  return {
    get: (signal) => transport.request({ method: 'GET', path: WEB_TABS_PATH, schema: WebTabsResponseSchema,
      what: '读竖排标签', lostAs: 'failed', signal }),
    put: (input) => transport.request({ method: 'PUT', path: WEB_TABS_PATH, body: input,
      schema: PutWebTabsResponseSchema, what: '存竖排标签', lostAs: 'uncertain',
      refine: conflictWith(WebTabsResponseSchema) }),
    merge: (input) => transport.request({ method: 'POST', path: WEB_TABS_MERGE_PATH, body: input,
      schema: WebTabsResponseSchema, what: '合并竖排标签', lostAs: 'uncertain' }),
    rememberIcon: (input) => transport.request({ method: 'PUT', path: FAVICON_PATH, body: input,
      schema: PutFaviconResponseSchema, what: '存网站图标', lostAs: 'uncertain' }),
    faviconSrc: (host) => faviconPath(host),
  };
}
