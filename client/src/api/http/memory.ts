// /v2/memory 的真实现（2026-11-03 起只读）：一条整理前的原话的详情（引用里的原话出处）和一条来源。
// 旧记忆条目的三栏、翻页、改、删界面都去掉了，客户端不再调那几个接口。

import type { MemoryApi } from '../client.ts';
import {
  MEMORY_ENTRIES_PATH,
  MEMORY_PATH,
  MemoryEntryDetailSchema,
  CognitionSourceDetailSchema,
} from '../shared.ts';
import type { MemoryEntryDetail } from '../types.ts';
import type { Transport } from './transport.ts';

function entryPath(id: string): string {
  return `${MEMORY_ENTRIES_PATH}/${encodeURIComponent(id)}`;
}

export class HttpMemory implements MemoryApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  source(id: string, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: `${MEMORY_PATH}/sources/${encodeURIComponent(id)}`,
      schema: CognitionSourceDetailSchema, what: '读证据原文和来源', lostAs: 'failed', signal });
  }

  async entry(id: string, signal?: AbortSignal): Promise<MemoryEntryDetail> {
    return this.transport.request({
      method: 'GET',
      path: entryPath(id),
      schema: MemoryEntryDetailSchema,
      what: '读这条记忆',
      lostAs: 'failed',
      signal,
    });
  }
}
