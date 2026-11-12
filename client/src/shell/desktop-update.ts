// 桌面客户端的更新（11-12 Aaron 定：侧栏更新按钮；查到新版只出按钮，点了才下，圆形进度，下完直接重开）。
// 侧栏按钮和设置 · 系统「客户端」那一行共用：读壳的更新状态、跟着壳报的变化走；「更新」= 下载 → 存好笔记 → 装上重开。
// 还有存不了的东西（对话草稿、待核实的写入）就先不重开，把原因交回去，处理完再点一次直接重开。

import { useEffect, useState } from 'react';
import type { PlasticineApi } from '../api/client.ts';
import type { DesktopEvent, UpdateStatus } from '../api/shared.ts';
import type { ClientState } from '../state/context.tsx';
import { DESKTOP_EVENT, listenDesktopEvents, parseUpdate, type DesktopShell } from '../views/settings/desktop-shell.ts';
import { refreshBlockers, saveNotesForRefresh } from './refresh-notes.ts';

/** 壳的更新状态；不在桌面客户端里，或还没读到，是 null。 */
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

/** 侧栏按钮出不出：查到新版、在下、下好了、在换，或者下载没成（还记着那一版，点了重试）。 */
export function updateVisible(status: UpdateStatus | null): boolean {
  if (status === null || status.available === null) return false;
  return ['available', 'downloading', 'ready', 'installing', 'failed'].includes(status.state);
}

/** 下载进度 0–1（不知道总数时是 0）。 */
export function updateFraction(status: UpdateStatus): number {
  const progress = status.progress ?? null;
  if (status.state === 'ready' || status.state === 'installing') return 1;
  if (progress === null || progress.total <= 0) return 0;
  return Math.min(1, progress.received / progress.total);
}

export type UpdateOutcome =
  | { kind: 'restarting' }
  /** 下载没成：原因在壳报的状态里（failed + problem）。 */
  | { kind: 'failed' }
  /** 下好了，但还有存不了的东西：先不重开。 */
  | { kind: 'blocked'; reasons: string[] };

/** 点了「更新」：没下就先下（壳边下边报进度），下好存好笔记，没有挡着的就装上重开。 */
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
