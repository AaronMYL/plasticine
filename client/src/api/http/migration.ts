import type { MigrationApi } from '../migration-client.ts';
import { createRequestId } from '../request-id.ts';
import {
  MIGRATION_CHUNK_BYTES, MIGRATION_EXPORT_CANCEL_PATH, MIGRATION_EXPORT_FILE_PATH, MIGRATION_EXPORT_PATH,
  MIGRATION_IMPORT_APPLY_PATH, MIGRATION_IMPORT_CANCEL_PATH, MIGRATION_IMPORT_COMPLETE_PATH, MIGRATION_IMPORT_PATH,
  MIGRATION_IMPORT_UNLOCK_PATH, MIGRATION_PATH, MIGRATION_UNDO_PATH, MigrationApplyResponseSchema,
  MigrationChunkResultSchema, MigrationImportViewSchema, MigrationStatusSchema, migrationChunkPath,
  type MigrationApplyResponse, type MigrationHow, type MigrationMode, type MigrationStatus,
} from '../shared.ts';
import { Type } from 'typebox';
import type { Transport } from './transport.ts';

const CHUNK_TIMEOUT_MS = 180_000;
const UNLOCK_TIMEOUT_MS = 60_000;

const StartSchema = Type.Object({ import: MigrationImportViewSchema, received: Type.Integer({ minimum: 0 }) });

export class HttpMigration implements MigrationApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  status(signal?: AbortSignal): Promise<MigrationStatus> {
    return this.transport.request({ method: 'GET', path: MIGRATION_PATH, schema: MigrationStatusSchema,
      what: '读数据迁移', lostAs: 'failed', signal });
  }

  startExport(mode: MigrationMode, passphrase: string | null): Promise<MigrationStatus> {
    return this.transport.request({ method: 'POST', path: MIGRATION_EXPORT_PATH,
      body: { requestId: createRequestId(), mode, ...(passphrase === null ? {} : { passphrase }) },
      schema: MigrationStatusSchema, what: '导出', lostAs: 'uncertain' });
  }

  cancelExport(): Promise<MigrationStatus> {
    return this.post(MIGRATION_EXPORT_CANCEL_PATH, {}, '取消导出');
  }

  exportUrl(): string {
    return MIGRATION_EXPORT_FILE_PATH;
  }

  async upload(file: Blob, name: string, onProgress?: (fraction: number) => void, signal?: AbortSignal):
    Promise<MigrationStatus> {
    const opened = await this.transport.request({ method: 'POST', path: MIGRATION_IMPORT_PATH, signal,
      body: { requestId: createRequestId(), name: name.slice(0, 200), bytes: file.size }, schema: StartSchema,
      what: '上传', lostAs: 'uncertain' });
    let received = opened.received;
    const report = (done: number): void => onProgress?.(file.size === 0 ? 1 : Math.min(1, done / file.size));
    report(received);
    let stalled = 0;
    while (received < file.size) {
      const from = received;
      const chunk = file.slice(from, Math.min(file.size, from + MIGRATION_CHUNK_BYTES));
      const result = await this.transport.request({ method: 'PUT', path: migrationChunkPath(from), binaryBody: chunk,
        signal, schema: MigrationChunkResultSchema, what: '上传', lostAs: 'uncertain', timeoutMs: CHUNK_TIMEOUT_MS,
        onUploadProgress: (fraction) => report(from + fraction * chunk.size) });
      received = result.received;
      stalled = received > from ? 0 : stalled + 1;
      if (stalled >= 3) throw new Error('传不上去：服务端一直没收下这一块，再选一次文件。');
      report(received);
    }
    return this.post(MIGRATION_IMPORT_COMPLETE_PATH, {}, '上传', signal);
  }

  unlock(passphrase: string): Promise<MigrationStatus> {
    return this.transport.request({ method: 'POST', path: MIGRATION_IMPORT_UNLOCK_PATH, body: { passphrase },
      schema: MigrationStatusSchema, what: '核对口令', lostAs: 'failed', timeoutMs: UNLOCK_TIMEOUT_MS });
  }

  apply(how: MigrationHow): Promise<MigrationApplyResponse> {
    return this.transport.request({ method: 'POST', path: MIGRATION_IMPORT_APPLY_PATH,
      body: { requestId: createRequestId(), how }, schema: MigrationApplyResponseSchema, what: '导入',
      lostAs: 'uncertain' });
  }

  cancelImport(): Promise<MigrationStatus> {
    return this.post(MIGRATION_IMPORT_CANCEL_PATH, { requestId: createRequestId() }, '取消导入');
  }

  undo(): Promise<MigrationApplyResponse> {
    return this.transport.request({ method: 'POST', path: MIGRATION_UNDO_PATH, body: { requestId: createRequestId() },
      schema: MigrationApplyResponseSchema, what: '退回', lostAs: 'uncertain' });
  }

  private post(path: string, body: Record<string, unknown>, what: string, signal?: AbortSignal):
    Promise<MigrationStatus> {
    return this.transport.request({ method: 'POST', path, body, schema: MigrationStatusSchema, what,
      lostAs: 'uncertain', signal });
  }
}
