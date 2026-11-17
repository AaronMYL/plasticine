// 设置 · 系统「数据迁移」（11-16）：导出两种、导入（分块传、口令、合并或替换）、退回。

import type { MigrationApplyResponse, MigrationHow, MigrationMode, MigrationStatus } from './shared.ts';

export interface MigrationApi {
  status(signal?: AbortSignal): Promise<MigrationStatus>;
  /** 全部导出要给口令；只要数据的不给。 */
  startExport(mode: MigrationMode, passphrase: string | null): Promise<MigrationStatus>;
  cancelExport(): Promise<MigrationStatus>;
  /** 导出好的文件的下载地址（带会话的普通链接）。 */
  exportUrl(): string;
  /** 报一份文件、一块块传、传完读文件头；progress 是 0–1。 */
  upload(file: Blob, name: string, onProgress?: (fraction: number) => void, signal?: AbortSignal):
    Promise<MigrationStatus>;
  unlock(passphrase: string): Promise<MigrationStatus>;
  apply(how: MigrationHow): Promise<MigrationApplyResponse>;
  cancelImport(): Promise<MigrationStatus>;
  undo(): Promise<MigrationApplyResponse>;
}
