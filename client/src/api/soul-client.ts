import type { ChangeSoulRequest, ConflictListResponse, ResolveConflictRequest, SoulView } from './shared.ts';

export interface SoulApi {
  get(signal?: AbortSignal): Promise<SoulView>;
  change(input: ChangeSoulRequest): Promise<SoulView>;
  /** GET /v2/memory/conflicts：没定的说法冲突（11-11）。 */
  conflicts(signal?: AbortSignal): Promise<ConflictListResponse>;
  /** POST /v2/memory/conflicts/:id/resolve：选以哪条为准。 */
  resolveConflict(id: string, input: ResolveConflictRequest): Promise<ConflictListResponse>;
}
