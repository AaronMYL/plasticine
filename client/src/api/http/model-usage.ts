import type { ModelUsageApi } from '../model-usage-client.ts';
import { MODEL_USAGE_PATH, ModelUsageReportSchema, type UsageRange } from '../shared.ts';
import type { Transport } from './transport.ts';

export class HttpModelUsage implements ModelUsageApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  report(range: UsageRange, timeZone: string, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: MODEL_USAGE_PATH, query: { range, tz: timeZone },
      schema: ModelUsageReportSchema, what: '读 AI 用量', lostAs: 'failed', signal });
  }
}
