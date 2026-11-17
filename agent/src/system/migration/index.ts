// system/migration/：设置 · 系统「数据迁移」（11-16）：导出两种（只要数据 / 全部，口令加密）、导入两种（合并 / 替换），
// 导入前在这台留一份 7 天能退回。文件格式 format.ts，带什么 layout.ts，打包 pack.ts，解开 unpack.ts，
// 启动时应用 apply.ts，服务这一头 service.ts，过期清理 cleanup.ts。

export { applyPendingMigration, readPending, readResult } from './apply.ts';
export type { PendingMigration } from './apply.ts';
export { cleanupMigration } from './cleanup.ts';
export { deriveKey, MigrationFileError, MigrationWriter, readArchive, readHeader } from './format.ts';
export { RESTART_EXIT_CODE } from './layout.ts';
export { stageForRestart } from './offline.ts';
export { packState } from './pack.ts';
export { MigrationProblem, MigrationService } from './service.ts';
export type { MigrationServiceOptions } from './service.ts';
export { readSummary, stageArchive, TooNewError } from './unpack.ts';
