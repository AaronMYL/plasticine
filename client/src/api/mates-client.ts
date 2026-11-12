import type { CreateMateRequest, UpdateMateRequest, MateView, MateListResponse, MateGroupView,
  CreateMateGroupRequest, UpdateMateGroupRequest, MateHandoffRequest, MateHandoffResponse,
  LegacyChatProposal, LegacyChatConvertRequest, LegacyChatConvertResponse, ListLinesResponse,
  SendLineMessageRequest, MainIdentity, UpdateMainRequest } from './shared.ts';

export interface MatesApi {
  list(signal?: AbortSignal): Promise<MateListResponse>;
  get(id: string, signal?: AbortSignal): Promise<MateView>;
  create(input: CreateMateRequest): Promise<MateView>;
  update(id: string, input: UpdateMateRequest): Promise<MateView>;
  handoff(input: MateHandoffRequest): Promise<MateHandoffResponse>;
  prepareLegacy(lineId: string): Promise<LegacyChatProposal>;
  convertLegacy(input: LegacyChatConvertRequest): Promise<LegacyChatConvertResponse>;
  /** POST /v2/main：主线的名字、头像字、颜色（第 12 批）。 */
  updateMain(input: UpdateMainRequest): Promise<{ main: MainIdentity }>;
}
export interface MateGroupsApi {
  create(input: CreateMateGroupRequest): Promise<MateGroupView>;
  update(id: string, input: UpdateMateGroupRequest): Promise<MateGroupView>;
  listTasks(id: string, signal?: AbortSignal): Promise<ListLinesResponse>;
  createTask(id: string, input: SendLineMessageRequest): Promise<MateHandoffResponse>;
}
