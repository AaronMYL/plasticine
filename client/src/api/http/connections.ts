// /v2/connections 和 /v2/pushes 的真实现（形状见 agent/shared/api/connections.ts、pushes.ts）。

import type { ConnectionsApi, PushesApi } from '../connections-client.ts';
import { createRequestId } from '../request-id.ts';
import {
  CONNECTIONS_PATH,
  ConnectionResponseSchema,
  ConnectionsResponseSchema,
  PUSH_WITHDRAW_PATH,
  PUSHES_PATH,
  PushesResponseSchema,
  PushWithdrawResponseSchema,
  connectionDeletePath,
  connectionPath,
  connectionTestPath,
  type ConnectionCreateRequest,
  type ConnectionUpdateRequest,
  type ConnectionView,
  type PushRecord,
} from '../shared.ts';
import type { Transport } from './transport.ts';

export class HttpConnections implements ConnectionsApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async list(signal?: AbortSignal): Promise<ConnectionView[]> {
    const response = await this.transport.request({ method: 'GET', path: CONNECTIONS_PATH,
      schema: ConnectionsResponseSchema, what: '读连接', lostAs: 'failed', signal });
    return response.connections;
  }

  create(input: ConnectionCreateRequest): Promise<ConnectionView> {
    return this.one(CONNECTIONS_PATH, input, '添加连接', 'uncertain');
  }

  update(id: string, input: ConnectionUpdateRequest): Promise<ConnectionView> {
    return this.one(connectionPath(id), input, '保存连接', 'uncertain');
  }

  test(id: string): Promise<ConnectionView> {
    return this.one(connectionTestPath(id), { requestId: createRequestId() }, '测试连接', 'failed');
  }

  async remove(id: string): Promise<void> {
    await this.transport.request({ method: 'POST', path: connectionDeletePath(id),
      body: { requestId: createRequestId() }, schema: ConnectionsResponseSchema, what: '删除连接',
      lostAs: 'uncertain' });
  }

  private async one(path: string, body: unknown, what: string, lostAs: 'failed' | 'uncertain'):
    Promise<ConnectionView> {
    const response = await this.transport.request({ method: 'POST', path, body, schema: ConnectionResponseSchema,
      what, lostAs });
    return response.connection;
  }
}

export class HttpPushes implements PushesApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async list(signal?: AbortSignal): Promise<PushRecord[]> {
    const response = await this.transport.request({ method: 'GET', path: PUSHES_PATH, schema: PushesResponseSchema,
      what: '读推送记录', lostAs: 'failed', signal });
    return response.pushes;
  }

  async withdraw(id: string): Promise<PushRecord> {
    const response = await this.transport.request({ method: 'POST', path: PUSH_WITHDRAW_PATH,
      body: { requestId: createRequestId(), id }, schema: PushWithdrawResponseSchema, what: '撤回推送',
      lostAs: 'uncertain' });
    return response.push;
  }
}
