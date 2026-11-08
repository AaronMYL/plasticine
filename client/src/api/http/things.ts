// 记忆主题的真实现（第 102 条第 2 批；第 10、16 条加了搜索和昨晚的整理）：按 shared/api 里的路径发请求、按同一份 schema
// 校验回答。

import type { MemoryTopicsApi, ThingsApi } from '../things-client.ts';
import {
  MEMORY_DREAMS_PATH,
  MEMORY_SEARCH_PATH,
  MEMORY_TOPICS_PATH,
  MemoryDreamChangeViewSchema,
  MemoryDreamViewSchema,
  MemorySearchResponseSchema,
  MemoryTopicDocSchema,
  MemoryTopicListResponseSchema,
} from '../shared.ts';
import type { Transport } from './transport.ts';

function changePath(id: string, action: 'undo' | 'choose'): string {
  return `${MEMORY_DREAMS_PATH}/changes/${encodeURIComponent(id)}/${action}`;
}

export function createThingsHttp(transport: Transport): ThingsApi {
  const memoryTopics: MemoryTopicsApi = {
    list: (signal) => transport.request({ method: 'GET', path: MEMORY_TOPICS_PATH,
      schema: MemoryTopicListResponseSchema, what: '读记忆主题', lostAs: 'failed', signal }),
    get: (id, signal) => transport.request({ method: 'GET', path: `${MEMORY_TOPICS_PATH}/${encodeURIComponent(id)}`,
      schema: MemoryTopicDocSchema, what: '读这份记忆文档', lostAs: 'failed', signal }),
    search: (q, archive, signal) => transport.request({ method: 'GET', path: MEMORY_SEARCH_PATH,
      query: { q, archive }, schema: MemorySearchResponseSchema, what: '搜记忆', lostAs: 'failed', signal }),
    dream: (signal) => transport.request({ method: 'GET', path: `${MEMORY_DREAMS_PATH}/latest`,
      schema: MemoryDreamViewSchema, what: '读昨晚的整理', lostAs: 'failed', signal }),
    undoDream: (id, input) => transport.request({ method: 'POST', path: changePath(id, 'undo'), body: input,
      schema: MemoryDreamChangeViewSchema, what: '撤销这一条', lostAs: 'uncertain' }),
    chooseDream: (id, input) => transport.request({ method: 'POST', path: changePath(id, 'choose'), body: input,
      schema: MemoryDreamChangeViewSchema, what: '定这一条', lostAs: 'uncertain' }),
  };
  return { memoryTopics };
}
