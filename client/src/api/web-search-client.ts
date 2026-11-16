// 设置 · 网络搜索（11-16 能力总表，Tavily）：读状态、填或清掉密钥、测试。密钥只写不读。

import type { SaveWebSearchRequest, TestWebSearchRequest, WebSearchStatus, WebSearchTestResponse } from './shared.ts';

export interface WebSearchApi {
  status(signal?: AbortSignal): Promise<WebSearchStatus>;
  save(input: SaveWebSearchRequest): Promise<WebSearchStatus>;
  test(input: TestWebSearchRequest): Promise<WebSearchTestResponse>;
}
