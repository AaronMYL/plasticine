import type { ChangeSoulRequest, SoulView } from './shared.ts';

export interface SoulApi {
  get(signal?: AbortSignal): Promise<SoulView>;
  change(input: ChangeSoulRequest): Promise<SoulView>;
}
