// 记忆主题的真实现（第 102 条第 2 批；第 10、16 条加了搜索和昨晚的整理）：按 shared/api 里的路径发请求、按同一份 schema
// 校验回答。

import type { MemoryTopicsApi, ThingsApi } from '../things-client.ts';
import {
  ApplyCleanupResponseSchema, LatestCleanupResponseSchema, MEMORY_CLEANUPS_PATH, MEMORY_DOCS_PATH, MEMORY_DREAMS_PATH,
  MEMORY_GRANTS_PATH, MEMORY_LOOP_GRANT_REVOKE_PATH, MEMORY_SEARCH_PATH, MEMORY_TOPICS_PATH, memoryCleanupApplyPath,
  MemoryDocResponseSchema, MemoryDreamChangeViewSchema, MemoryDreamViewSchema, MemoryGrantsResponseSchema,
  memoryLineMovePath, memoryLinesPath, MemorySearchResponseSchema, MemoryTopicDocSchema, MemoryTopicListResponseSchema,
} from '../shared.ts';
import type { Transport } from './transport.ts';
import { Type } from 'typebox';

const Anything = Type.Unknown();
const linePath = (docId: string, lineId: string) =>
  `${MEMORY_DOCS_PATH}/${encodeURIComponent(docId)}/lines/${encodeURIComponent(lineId)}`;

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
    addLine: async (docId, input) => {
      await transport.request({ method: 'POST', path: memoryLinesPath(docId), body: input, schema: Anything,
        what: '加一条记忆', lostAs: 'uncertain' });
    },
    editLine: async (docId, lineId, input) => {
      await transport.request({ method: 'PUT', path: linePath(docId, lineId), body: input, schema: Anything,
        what: '改这一条记忆', lostAs: 'uncertain' });
    },
    retireLine: async (docId, lineId, input) => {
      await transport.request({ method: 'POST', path: `${linePath(docId, lineId)}/retire`, body: input,
        schema: Anything, what: '删这一条记忆', lostAs: 'uncertain' });
    },
    moveLine: async (docId, lineId, input) => {
      await transport.request({ method: 'POST', path: memoryLineMovePath(docId, lineId), body: input,
        schema: Anything, what: '挪这一条记忆', lostAs: 'uncertain' });
    },
    withdrawn: async (docId, signal) => {
      const doc = await transport.request({ method: 'GET', path: `${MEMORY_DOCS_PATH}/${encodeURIComponent(docId)}`,
        query: { includeRetired: true }, schema: MemoryDocResponseSchema, what: '读收回过的几条', lostAs: 'failed',
        signal });
      // 收回的是「不再成立」那一种；被改掉、挪走的旧行不算。
      return (doc.retired ?? []).filter((line) => line.retiredReason === 'no_longer_true' && line.retiredAt !== null)
        .map((line) => ({ id: line.id, text: line.text, section: line.section, retiredAt: line.retiredAt ?? '' }));
    },
    grants: (signal) => transport.request({ method: 'GET', path: MEMORY_GRANTS_PATH,
      schema: MemoryGrantsResponseSchema, what: '读放过手的几类', lostAs: 'failed', signal }),
    revokeLoopGrant: (input) => transport.request({ method: 'POST', path: MEMORY_LOOP_GRANT_REVOKE_PATH, body: input,
      schema: MemoryGrantsResponseSchema, what: '收回这一类', lostAs: 'uncertain' }),
    cleanup: (signal) => transport.request({ method: 'GET', path: `${MEMORY_CLEANUPS_PATH}/latest`,
      schema: LatestCleanupResponseSchema, what: '读整理清单', lostAs: 'failed', signal }),
    startCleanup: async (input) => {
      await transport.request({ method: 'POST', path: MEMORY_CLEANUPS_PATH, body: input, schema: Anything,
        what: '开始全量整理', lostAs: 'uncertain' });
    },
    applyCleanup: (id, input) => transport.request({ method: 'POST', path: memoryCleanupApplyPath(id), body: input,
      schema: ApplyCleanupResponseSchema, what: '采用整理清单', lostAs: 'uncertain' }),
  };
  return { memoryTopics };
}
