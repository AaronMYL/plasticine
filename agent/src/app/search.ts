import { SearchQuerySchema } from '../../shared/api/index.ts';
import { SearchQueryError } from '../../shared/search.ts';
import { StateError } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { checkInput, queryObject } from './validate.ts';

export function search(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(SearchQuerySchema,
    queryObject(context.url.searchParams, { limit: 'integer', includeArchived: 'boolean' }), '查找条件');
  try { return { status: 200, body: context.deps.state.search.query(query) }; }
  catch (cause) {
    if (cause instanceof SearchQueryError) {
      throw new ApiError(400, 'invalid_request', cause.message, { next: '从第一页重新查找。' });
    }
    if (cause instanceof StateError && cause.code === 'corrupt_record') {
      throw new ApiError(503, 'search_unavailable', '有保存的内容暂时无法读取，查找未完成。',
        { next: '重试，或先选择其他类型查找。' });
    }
    throw cause;
  }
}
