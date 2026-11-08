// /v2/system/operations：设置 · 系统「运行情况」——版本、跑了多久、外环扫描、磁盘、最近一份备份、通知信与收信、最近的通知卡。
// 2026-11-05 Harness 重做：定时任务、结果反馈的接口随任务删掉；回给旧客户端的 tasks / brief / performance 恒为空
// （shared/api/systems.ts 里标着待客户端切完后删）。

import { statfsSync } from 'node:fs';
import type { SystemOperations } from '../../shared/api/systems.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';

// 剩不到 1 GB 就提醒。
const DISK_LOW_BYTES = 1024 ** 3;

export function getSystemOperations(context: RequestContext): Reply {
  requireAuth(context);
  const { state, now, clientUpdates, m5b, scans } = context.deps;
  const disk = statfsSync(m5b.stateDirectory);
  const body: SystemOperations = { ...state.systemOperations.read(),
    version: clientUpdates.view().current?.buildId ?? null,
    uptimeSeconds: Math.max(0, (now().getTime() - Date.parse(context.deps.startedAt)) / 1000),
    scans: scans.status(), diskFreeBytes: disk.bavail * disk.bsize, diskTotalBytes: disk.blocks * disk.bsize,
    diskLow: disk.bavail * disk.bsize < DISK_LOW_BYTES,
    backupAt: state.backups.list().filter((backup) => backup.status === 'ready')
      .map((backup) => backup.completedAt).filter((at): at is string => at !== null).sort().at(-1) ?? null,
  };
  return { status: 200, body };
}
