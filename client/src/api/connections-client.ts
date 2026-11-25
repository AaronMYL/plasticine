import type {
  ConnectionCreateRequest,
  ConnectionUpdateRequest,
  ConnectionView,
  PushRecord,
} from './shared.ts';

export interface ConnectionsApi {
  list(signal?: AbortSignal): Promise<ConnectionView[]>;
  create(input: ConnectionCreateRequest): Promise<ConnectionView>;
  update(id: string, input: ConnectionUpdateRequest): Promise<ConnectionView>;
  test(id: string): Promise<ConnectionView>;
  remove(id: string): Promise<void>;
}

export interface PushesApi {
  list(signal?: AbortSignal): Promise<PushRecord[]>;
  withdraw(id: string): Promise<PushRecord>;
}
