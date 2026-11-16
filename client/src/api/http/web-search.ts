// /v2/settings/web-search 的真实现（形状见 agent/shared/api/web-search.ts）。

import type { WebSearchApi } from '../web-search-client.ts';
import {
  WEB_SEARCH_PATH,
  WEB_SEARCH_TEST_PATH,
  WebSearchStatusSchema,
  WebSearchTestResponseSchema,
  type SaveWebSearchRequest,
  type TestWebSearchRequest,
} from '../shared.ts';
import type { Transport } from './transport.ts';

export class HttpWebSearch implements WebSearchApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  status(signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: WEB_SEARCH_PATH, schema: WebSearchStatusSchema,
      what: '读网络搜索设置', lostAs: 'failed', signal });
  }

  save(input: SaveWebSearchRequest) {
    return this.transport.request({ method: 'PUT', path: WEB_SEARCH_PATH, body: input, schema: WebSearchStatusSchema,
      what: '保存网络搜索的密钥', lostAs: 'uncertain' });
  }

  test(input: TestWebSearchRequest) {
    return this.transport.request({ method: 'POST', path: WEB_SEARCH_TEST_PATH, body: input,
      schema: WebSearchTestResponseSchema, what: '测试网络搜索', lostAs: 'failed' });
  }
}
