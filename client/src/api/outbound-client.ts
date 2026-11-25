import type { CreateOutboundGrantRequest, EditOutboundGrantRequest, RevokeOutboundGrantRequest,
  OutboundGrant, OutboundLog } from './shared.ts';

export interface OutboundApi {
  grants(signal?: AbortSignal): Promise<OutboundGrant[]>;
  logs(signal?: AbortSignal): Promise<OutboundLog[]>;
  log(id: string, signal?: AbortSignal): Promise<OutboundLog>;
  create(input: CreateOutboundGrantRequest): Promise<OutboundGrant>;
  edit(id: string, input: EditOutboundGrantRequest): Promise<OutboundGrant>;
  revoke(id: string, input: RevokeOutboundGrantRequest): Promise<OutboundGrant>;
}
