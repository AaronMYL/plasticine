import type { SystemOperations } from './shared.ts';
export interface SystemsApi {
  /** GET /v2/system/operations：设置 · 系统里的运行情况。 */
  operations(signal?: AbortSignal): Promise<SystemOperations>;
}
