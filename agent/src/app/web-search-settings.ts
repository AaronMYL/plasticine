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

export async function saveWebSearch(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(SaveWebSearchRequestSchema, await readJsonBody(context.req), '网络搜索');
  return idempotent(context, input.requestId, () => ({ status: 200,
    body: context.deps.toolGroups.webSearch.save(input.apiKey) }));
}

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
