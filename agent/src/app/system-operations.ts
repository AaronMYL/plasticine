import { statfsSync } from 'node:fs';
import type { SystemOperations } from '../../shared/api/systems.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';

const DISK_LOW_BYTES = 1024 ** 3;

export function getSystemOperations(context: RequestContext): Reply {
  requireAuth(context);
  const { state, now, clientUpdates, toolGroups, scans } = context.deps;
  const disk = statfsSync(toolGroups.stateDirectory);
  const body: SystemOperations = { ...state.systemOperations.read(),
    version: clientUpdates.version().current?.buildId ?? null,
    uptimeSeconds: Math.max(0, (now().getTime() - Date.parse(context.deps.startedAt)) / 1000),
    scans: scans.status(), diskFreeBytes: disk.bavail * disk.bsize, diskTotalBytes: disk.blocks * disk.bsize,
    diskLow: disk.bavail * disk.bsize < DISK_LOW_BYTES,
    backupAt: state.backups.list().filter((backup) => backup.status === 'ready')
      .map((backup) => backup.completedAt).filter((at): at is string => at !== null).sort().at(-1) ?? null,
  };
  return { status: 200, body };
}
