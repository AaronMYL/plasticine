import { useEffect, useState } from 'react';
import type { PlasticineApi } from '../api/client.ts';
import type { DesktopEvent, UpdateStatus } from '../api/shared.ts';
import type { ClientState } from '../state/context.tsx';
import { DESKTOP_EVENT, listenDesktopEvents, parseUpdate, type DesktopShell } from '../views/settings/desktop-shell.ts';
import { refreshBlockers, saveNotesForRefresh } from './refresh-notes.ts';

export function useDesktopUpdate(shell: DesktopShell | null): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    if (shell === null) return undefined;
    let alive = true;
    shell.updates.status().then((value) => { if (alive) setStatus(parseUpdate(value)); },
      (cause: unknown) => console.warn('没读到客户端的更新状态', cause));
    listenDesktopEvents();
    const receive = (event: Event): void => {
      const detail = (event as CustomEvent<DesktopEvent>).detail;
      if (detail.type === 'update') setStatus(detail.status);
    };
    window.addEventListener(DESKTOP_EVENT, receive);
    return () => {
      alive = false;
      window.removeEventListener(DESKTOP_EVENT, receive);
    };
  }, [shell]);
  return status;
}

export function updateVisible(status: UpdateStatus | null): boolean {
  if (status === null || status.available === null) return false;
  return ['available', 'downloading', 'ready', 'installing', 'failed'].includes(status.state);
}

export function updateFraction(status: UpdateStatus): number {
  const progress = status.progress ?? null;
  if (status.state === 'ready' || status.state === 'installing') return 1;
  if (progress === null || progress.total <= 0) return 0;
  return Math.min(1, progress.received / progress.total);
}

export type UpdateOutcome =
  | { kind: 'restarting' }
  | { kind: 'failed' }
  | { kind: 'blocked'; reasons: string[] };

export async function runDesktopUpdate(shell: DesktopShell, api: PlasticineApi, state: ClientState,
  current: UpdateStatus): Promise<UpdateOutcome> {
  let status = current;
  if (status.state === 'available' || status.state === 'failed') {
    status = parseUpdate(await shell.updates.download());
  }
  if (status.state !== 'ready') return { kind: 'failed' };
  const reasons = await saveNotesForRefresh(api, state);
  const blockers = reasons.length > 0 ? reasons : refreshBlockers(state);
  if (blockers.length > 0) return { kind: 'blocked', reasons: blockers };
  shell.updates.install();
  return { kind: 'restarting' };
}
