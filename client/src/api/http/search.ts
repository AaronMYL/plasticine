import type { SearchApi } from '../client.ts';
import { SEARCH_PATH, SearchResponseSchema, type SearchQuery, type SearchResponse } from '../shared.ts';
import type { Transport } from './transport.ts';

export class HttpSearch implements SearchApi {
  private readonly transport: Transport;
  constructor(transport: Transport) { this.transport = transport; }
  query(input: SearchQuery, signal?: AbortSignal): Promise<SearchResponse> {
    return this.transport.request({ method: 'GET', path: SEARCH_PATH, query: input,
      schema: SearchResponseSchema, what: '查找内容', lostAs: 'failed', signal });
  }
}
