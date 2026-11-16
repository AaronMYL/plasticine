// /v2/settings/web-search：网络搜索的密钥（11-16 能力总表，Tavily）。只写不读：回填没填、末尾几位、这个月用了几次；
// 测试用一次真搜索验证，失败写清为什么。保存要本人会话（以后的搜索都花他的额度）。

import {
  SaveWebSearchRequestSchema,
  TestWebSearchRequestSchema,
  type WebSearchTestResponse,
} from '../../shared/api/index.ts';
import { requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

/** GET */
export function getWebSearch(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: context.deps.toolGroups.webSearch.status() };
}

/** PUT：填、换或清掉密钥。 */
export async function saveWebSearch(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(SaveWebSearchRequestSchema, await readJsonBody(context.req), '网络搜索');
  return idempotent(context, input.requestId, () => ({ status: 200,
    body: context.deps.toolGroups.webSearch.save(input.apiKey) }));
}

/** POST /test：不走幂等回放（试的就是现在通不通）。 */
export async function testWebSearch(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  checkInput(TestWebSearchRequestSchema, await readJsonBody(context.req), '测试');
  const gone = new AbortController();
  const close = (): void => gone.abort();
  context.res.once('close', close);
  try {
    const search = context.deps.toolGroups.webSearch;
    const result = await search.test(gone.signal);
    const body: WebSearchTestResponse = { ...result, status: search.status() };
    return { status: 200, body };
  } finally {
    context.res.removeListener('close', close);
  }
}
