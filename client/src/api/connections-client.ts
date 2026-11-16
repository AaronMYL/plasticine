// 设置 · AI · 连接（11-16，通用连接）和记忆 · 主动告诉你里推到手机的记录。

import type {
  ConnectionCreateRequest,
  ConnectionUpdateRequest,
  ConnectionView,
  PushRecord,
} from './shared.ts';

export interface ConnectionsApi {
  list(signal?: AbortSignal): Promise<ConnectionView[]>;
  /** 加一个：服务端加完马上测一次，回测的结果。 */
  create(input: ConnectionCreateRequest): Promise<ConnectionView>;
  update(id: string, input: ConnectionUpdateRequest): Promise<ConnectionView>;
  test(id: string): Promise<ConnectionView>;
  remove(id: string): Promise<void>;
}

export interface PushesApi {
  /** 最近推到手机的几条，新的在前。 */
  list(signal?: AbortSignal): Promise<PushRecord[]>;
  withdraw(id: string): Promise<PushRecord>;
}
