import type { NodesApi } from '../client.ts';
import {
  NODE_ACTIONS_PATH,
  NodeActionListResponseSchema,
  NodeListResponseSchema,
  NodeResponseSchema,
  NODES_PATH,
} from '../shared.ts';
import type { NodeActionView, NodeListResponse, NodeView, RevokeNodeRequest } from '../types.ts';
import type { Transport } from './transport.ts';

export class HttpNodes implements NodesApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  list(signal?: AbortSignal): Promise<NodeListResponse> {
    return this.transport.request({
      method: 'GET',
      path: NODES_PATH,
      schema: NodeListResponseSchema,
      what: '读设备列表',
      lostAs: 'failed',
      signal,
    });
  }

  async actions(nodeId: string | null, signal?: AbortSignal): Promise<NodeActionView[]> {
    const response = await this.transport.request({
      method: 'GET',
      path: NODE_ACTIONS_PATH,
      query: { nodeId: nodeId ?? undefined },
      schema: NodeActionListResponseSchema,
      what: '读设备动作',
      lostAs: 'failed',
      signal,
    });
    return response.actions;
  }

  async revoke(id: string, input: RevokeNodeRequest): Promise<NodeView> {
    const response = await this.transport.request({
      method: 'POST',
      path: `${NODES_PATH}/${encodeURIComponent(id)}/revoke`,
      body: input,
      schema: NodeResponseSchema,
      what: '撤销节点',
      lostAs: 'uncertain',
    });
    return response.node;
  }
}
