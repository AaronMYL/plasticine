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
