// GET /v2/system/operations：设置 · 系统里的运行情况（版本、开了多久、收发信、扫描、磁盘、备份、最近的通知）。
// 2026-11-05 任务和定时任务删了，任务计数、定时任务和任务反馈的接口一起删。

import { Type, type Static } from 'typebox';
import { IsoTimeSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const SYSTEM_OPERATIONS_PATH = '/v2/system/operations';
export const SystemOperationsSchema = Type.Object({
  version: OrNull(Type.String()), uptimeSeconds: Type.Number(),
  mail: Type.Object({ sentAt: OrNull(IsoTimeSchema), sendError: OrNull(Type.String()),
    receivedAt: OrNull(IsoTimeSchema), receiveError: OrNull(Type.String()) }),
  scans: Type.Array(Type.Object({ name: Type.String(), at: IsoTimeSchema, error: OrNull(Type.String()),
    running: Type.Boolean() })),
  diskFreeBytes: Type.Number(), diskTotalBytes: Type.Number(), diskLow: Type.Boolean(),
  backupAt: OrNull(IsoTimeSchema),
  notifications: Type.Array(Type.Object({ id: Type.String(), at: IsoTimeSchema, kind: Type.String(),
    summary: Type.String(), askId: OrNull(Type.String()) })),
});
export type SystemOperations = Static<typeof SystemOperationsSchema>;
