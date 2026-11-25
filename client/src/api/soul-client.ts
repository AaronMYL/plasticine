import type { ChangeSoulRequest, ConflictListResponse, ResolveConflictRequest, SoulView } from './shared.ts';

export interface SoulApi {
  get(signal?: AbortSignal): Promise<SoulView>;
  change(input: ChangeSoulRequest): Promise<SoulView>;
  conflicts(signal?: AbortSignal): Promise<ConflictListResponse>;
  resolveConflict(id: string, input: ResolveConflictRequest): Promise<ConflictListResponse>;
}
