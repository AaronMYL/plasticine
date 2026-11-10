import type { CreateMateRequest, UpdateMateRequest, MateView, MateListResponse, MateGroupView,
  CreateMateGroupRequest, UpdateMateGroupRequest, MateHandoffRequest, MateHandoffResponse,
  LegacyChatProposal, LegacyChatConvertRequest, LegacyChatConvertResponse } from './shared.ts';

export interface MatesApi {
  list(signal?: AbortSignal): Promise<MateListResponse>;
  get(id: string, signal?: AbortSignal): Promise<MateView>;
  create(input: CreateMateRequest): Promise<MateView>;
  update(id: string, input: UpdateMateRequest): Promise<MateView>;
  handoff(input: MateHandoffRequest): Promise<MateHandoffResponse>;
  prepareLegacy(lineId: string): Promise<LegacyChatProposal>;
  convertLegacy(input: LegacyChatConvertRequest): Promise<LegacyChatConvertResponse>;
}
export interface MateGroupsApi {
  create(input: CreateMateGroupRequest): Promise<MateGroupView>;
  update(id: string, input: UpdateMateGroupRequest): Promise<MateGroupView>;
}
