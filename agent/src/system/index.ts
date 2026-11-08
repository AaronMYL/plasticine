// system/：Plasticine 自己这台电脑上的事——本机每日备份、寄给他自己的通知信、界面发起的对外动作的回执幂等。
// 2026-11-05 Harness 重做删掉 execution/ 时从那里挪出来的三样，都不借任务系统。

export { BACKUP_CHECK_MS, BackupService } from './backup-service.ts';
export type { BackupServiceOptions } from './backup-service.ts';
export { runExternalOnce, settleExternal } from './external-once.ts';
export type { DefiniteFailure, ExternalAction, ExternalOutcome } from './external-once.ts';
export { argsDigest, canonicalJson, decideReplay } from './receipts.ts';
export type { ReplayDecision, ReplayInput } from './receipts.ts';
export { ClientReleases } from './client-releases.ts';
export type { ClientReleaseOptions } from './client-releases.ts';
export { manifestDigest, readClientManifest, readClientPublication, recordClientRelease } from './client-manifest.ts';
export { parseDiff } from './diff.ts';
export type { DiffFile, DiffLine } from './diff.ts';
export { checkTokens, DESIGN_TOKENS } from './token-check.ts';
export type { TokenViolation } from './token-check.ts';
