// /v2/memory：旧记忆条目（memory_entries）的只读接口——三栏第一页、某一栏往后翻、一条和它的来路。
// 2026-11-03 起旧条目的改、删、新建接口都删掉了（由后台一次性整理进主题文档，docs/specs/memory-docs.md 第 5 节）；
// 这里留给记忆文档里链回的原话出处读。2026-11-05 ≠ 标记删掉，disagreements 恒为空。

import {
  COGNITION_PAGE_DEFAULT,
  MemoryBoardQuerySchema,
  MemoryEntriesQuerySchema,
  type AgreementListResponse,
  type MemoryBoardResponse,
  type MemoryColumn,
  type MemoryEntryDetail,
  type MemoryBoardQuery,
} from '../../shared/api/index.ts';
import type { MemoryEntry } from '../../shared/state.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { agreementView, changeRecords, memoryEntryView } from './cognition-views.ts';
import { memorySource } from './cognition-source.ts';
import { param, requireAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { checkInput, queryObject } from './validate.ts';

function column(deps: AppDeps, kind: MemoryEntry['kind'], includeArchived: boolean, limit: number, offset: number,
  filter: MemoryBoardQuery = {}) {
  const page = deps.state.memory.newestFirst(kind, includeArchived, { limit: limit + 1, offset }, filter);
  const result: MemoryColumn = {
    entries: page.slice(0, limit).map((entry) => memoryEntryView(entry)),
    nextOffset: page.length > limit ? offset + limit : null,
  };
  return result;
}

function agreementColumn(deps: AppDeps, limit: number): AgreementListResponse {
  const page = deps.state.agreements.newestFirst({}, { limit: limit + 1, offset: 0 });
  return {
    agreements: page.slice(0, limit).map((agreement) => agreementView(agreement)),
    nextOffset: page.length > limit ? limit : null,
  };
}

/** GET /v2/memory */
export function getMemoryBoard(context: RequestContext): Reply {
  requireAuth(context);
  const types = { limit: 'integer', includeArchived: 'boolean', includeStale: 'boolean' } as const;
  const query = checkInput(MemoryBoardQuerySchema, queryObject(context.url.searchParams, types), '查询参数');
  const limit = query.limit ?? COGNITION_PAGE_DEFAULT;
  const archived = query.includeArchived ?? false;
  const body: MemoryBoardResponse = {
    quotes: column(context.deps, 'quote', archived, limit, 0, query),
    interpretations: column(context.deps, 'interpretation', archived, limit, 0, query),
    agreements: agreementColumn(context.deps, limit),
  };
  return { status: 200, body };
}

/** GET /v2/memory/entries */
export function listMemoryEntries(context: RequestContext): Reply {
  requireAuth(context);
  const types = { limit: 'integer', offset: 'integer', includeArchived: 'boolean', unsettledOnly: 'boolean',
    includeStale: 'boolean' } as const;
  const query = checkInput(MemoryEntriesQuerySchema, queryObject(context.url.searchParams, types), '查询参数');
  const limit = query.limit ?? COGNITION_PAGE_DEFAULT;
  if (query.unsettledOnly) {
    if (query.kind !== 'quote') {
      throw new ApiError(400, 'invalid_input', '待落实列表只收原话。');
    }
    const offset = query.offset ?? 0;
    const page = context.deps.state.memory.unsettledQuotes({ limit, offset });
    return { status: 200, body: { entries: page.entries.map((entry) => memoryEntryView(entry)),
      nextOffset: offset + limit < page.total ? offset + limit : null, total: page.total } };
  }
  const body = column(context.deps, query.kind, query.includeArchived ?? false, limit, query.offset ?? 0, query);
  return { status: 200, body };
}

/** GET /v2/memory/entries/:id — an archived entry is still readable, with archivedAt set. */
export function getMemoryEntry(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const entry = state.memory.get(param(context, 'id'));
  if (entry === undefined) {
    throw notFoundError('这条记忆');
  }
  const body: MemoryEntryDetail = {
    entry: memoryEntryView(entry),
    history: changeRecords(state.memory.history(entry.id), state),
    sourceContext: memorySource(state, entry.anchor),
  };
  return { status: 200, body };
}
