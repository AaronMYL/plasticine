import type { ModelUsageReport, UsageRange } from './shared.ts';

export interface ModelUsageApi {
  report(range: UsageRange, timeZone: string, signal?: AbortSignal): Promise<ModelUsageReport>;
}
