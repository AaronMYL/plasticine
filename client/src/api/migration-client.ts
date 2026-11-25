import type { MigrationApplyResponse, MigrationHow, MigrationMode, MigrationStatus } from './shared.ts';

export interface MigrationApi {
  status(signal?: AbortSignal): Promise<MigrationStatus>;
  startExport(mode: MigrationMode, passphrase: string | null): Promise<MigrationStatus>;
  cancelExport(): Promise<MigrationStatus>;
  exportUrl(): string;
  upload(file: Blob, name: string, onProgress?: (fraction: number) => void, signal?: AbortSignal):
    Promise<MigrationStatus>;
  unlock(passphrase: string): Promise<MigrationStatus>;
  apply(how: MigrationHow): Promise<MigrationApplyResponse>;
  cancelImport(): Promise<MigrationStatus>;
  undo(): Promise<MigrationApplyResponse>;
}
