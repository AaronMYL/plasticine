// 设置 · AI 最上面的「用量」（11-18）：按今天 / 7 天 / 30 天读一份汇总，时间按这台设备的时区分天。

import type { ModelUsageReport, UsageRange } from './shared.ts';

export interface ModelUsageApi {
  report(range: UsageRange, timeZone: string, signal?: AbortSignal): Promise<ModelUsageReport>;
}
