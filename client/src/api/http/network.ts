// /v2/network 和 /v2/visibility 的真实现（第 113 条）：这台 Plasticine 在网络上的账号、加入、邀请朋友；对外可见的矩阵、
// 定档、确认 Plasticine 的建议。定档带 version，409 时按整张矩阵认不出 current，走通用的冲突分类。

import type {
  ConfirmMarksRequest,
  CreateInviteRequest,
  JoinNetworkRequest,
  NetworkApi,
  NetworkInviteResponse,
  SetAvatarRequest,
  SetMarkRequest,
  VisibilityApi,
} from '../contacts-client.ts';
import {
  NETWORK_AVATAR_PATH,
  NETWORK_INVITES_PATH,
  NETWORK_JOIN_PATH,
  NETWORK_PATH,
  NetworkInviteResponseSchema,
  NetworkInvitesResponseSchema,
  NetworkStatusSchema,
  VISIBILITY_CONFIRM_PATH,
  VISIBILITY_MARKS_PATH,
  VISIBILITY_PATH,
  VisibilityResponseSchema,
  type NetworkInvite,
  type NetworkStatus,
  type VisibilityResponse,
} from '../shared.ts';
import type { Transport } from './transport.ts';

export class HttpNetwork implements NetworkApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  status(signal?: AbortSignal): Promise<NetworkStatus> {
    return this.transport.request({
      method: 'GET',
      path: NETWORK_PATH,
      schema: NetworkStatusSchema,
      what: '读网络账号',
      lostAs: 'failed',
      signal,
    });
  }

  join(input: JoinNetworkRequest): Promise<NetworkStatus> {
    return this.transport.request({
      method: 'POST',
      path: NETWORK_JOIN_PATH,
      body: input,
      schema: NetworkStatusSchema,
      what: '加入网络',
      lostAs: 'uncertain',
    });
  }

  createInvite(input: CreateInviteRequest): Promise<NetworkInviteResponse> {
    return this.transport.request({
      method: 'POST',
      path: NETWORK_INVITES_PATH,
      body: input,
      schema: NetworkInviteResponseSchema,
      what: '生成邀请码',
      lostAs: 'uncertain',
    });
  }

  setAvatar(input: SetAvatarRequest): Promise<NetworkStatus> {
    return this.transport.request({
      method: 'POST',
      path: NETWORK_AVATAR_PATH,
      body: input,
      schema: NetworkStatusSchema,
      what: '换头像',
      lostAs: 'uncertain',
    });
  }

  async invites(signal?: AbortSignal): Promise<NetworkInvite[]> {
    const response = await this.transport.request({
      method: 'GET',
      path: NETWORK_INVITES_PATH,
      schema: NetworkInvitesResponseSchema,
      what: '读邀请码',
      lostAs: 'failed',
      signal,
    });
    return response.invites;
  }
}

export class HttpVisibility implements VisibilityApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  get(signal?: AbortSignal): Promise<VisibilityResponse> {
    return this.transport.request({
      method: 'GET',
      path: VISIBILITY_PATH,
      schema: VisibilityResponseSchema,
      what: '读对外可见',
      lostAs: 'failed',
      signal,
    });
  }

  mark(input: SetMarkRequest): Promise<VisibilityResponse> {
    return this.transport.request({
      method: 'POST',
      path: VISIBILITY_MARKS_PATH,
      body: input,
      schema: VisibilityResponseSchema,
      what: '定档',
      lostAs: 'uncertain',
    });
  }

  confirm(input: ConfirmMarksRequest): Promise<VisibilityResponse> {
    return this.transport.request({
      method: 'POST',
      path: VISIBILITY_CONFIRM_PATH,
      body: input,
      schema: VisibilityResponseSchema,
      what: '确认建议',
      lostAs: 'uncertain',
    });
  }
}
