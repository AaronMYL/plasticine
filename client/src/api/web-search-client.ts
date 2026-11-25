import type { SaveWebSearchRequest, TestWebSearchRequest, WebSearchStatus, WebSearchTestResponse } from './shared.ts';

export interface WebSearchApi {
  status(signal?: AbortSignal): Promise<WebSearchStatus>;
  save(input: SaveWebSearchRequest): Promise<WebSearchStatus>;
  test(input: TestWebSearchRequest): Promise<WebSearchTestResponse>;
}
