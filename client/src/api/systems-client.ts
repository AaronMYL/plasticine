import type { SystemOperations } from './shared.ts';
export interface SystemsApi {
  operations(signal?: AbortSignal): Promise<SystemOperations>;
}
