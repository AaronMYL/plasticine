import type { BackupsApi } from '../client.ts';
import {
  BackupListSchema,
  BackupSchema,
  BackupDetailSchema,
  RestorePreviewSchema,
  type CreateBackupRequest,
  type RestorePreviewRequest,
} from '../shared.ts';
import type { Transport } from './transport.ts';
export class HttpBackups implements BackupsApi {
  private readonly transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  list(signal?: AbortSignal) {
    return this.transport.request({
      method: 'GET',
      path: '/v2/backups',
      schema: BackupListSchema,
      what: '读取本机备份',
      lostAs: 'failed',
      ...(signal === undefined ? {} : { signal }),
    });
  }
  get(id: string, signal?: AbortSignal) {
    return this.transport.request({
      method: 'GET',
      path: `/v2/backups/${encodeURIComponent(id)}`,
      schema: BackupDetailSchema,
      what: '校验本机备份',
      lostAs: 'failed',
      ...(signal === undefined ? {} : { signal }),
    });
  }
  getPreview(id: string, signal?: AbortSignal) {
    return this.transport.request({
      method: 'GET',
      path: `/v2/restore-previews/${encodeURIComponent(id)}`,
      schema: RestorePreviewSchema,
      what: '读取恢复预览',
      lostAs: 'failed',
      ...(signal === undefined ? {} : { signal }),
    });
  }
  create(body: CreateBackupRequest) {
    return this.transport.request({
      method: 'POST',
      path: '/v2/backups',
      body,
      schema: BackupSchema,
      what: '生成本机备份',
      lostAs: 'uncertain',
    });
  }
  preview(id: string, body: RestorePreviewRequest) {
    return this.transport.request({
      method: 'POST',
      path: `/v2/backups/${encodeURIComponent(id)}/restore-preview`,
      body,
      schema: RestorePreviewSchema,
      what: '预览按对象恢复',
      lostAs: 'uncertain',
    });
  }
}
