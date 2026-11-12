// 侧栏（图标栏）下方、搜索上面的更新按钮（11-12 设计稿「Plasticine 侧栏更新按钮」）：只在桌面客户端里、查到新版时出，
// 没有新版时不渲染、不占位置。有新版：陶土色下载图标；点了：圆形进度按已下 / 总共走；下完：勾，存好笔记就重开；
// 没下成：重试图标 + 右上错误色小点，点了重下。悬停说明写版本号、百分比或原因。

import { useState, type ReactNode } from 'react';
import { useApi } from '../api/context.tsx';
import type { UpdateStatus } from '../api/shared.ts';
import { useClientState } from '../state/context.tsx';
import { desktopShell } from '../views/settings/desktop-shell.ts';
import { runDesktopUpdate, updateFraction, updateVisible, useDesktopUpdate } from './desktop-update.ts';
import { Icon } from './icons.tsx';

const RING_RADIUS = 8;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function Ring({ fraction, done }: { fraction: number; done: boolean }): ReactNode {
  return (
    <svg className="rail-update-ring" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r={RING_RADIUS} className="rail-update-track" />
      <circle cx="10" cy="10" r={RING_RADIUS} className="rail-update-arc" transform="rotate(-90 10 10)"
        strokeDasharray={`${(RING_LENGTH * fraction).toFixed(2)} ${RING_LENGTH.toFixed(2)}`} />
      {done ? <path className="rail-update-check" d="M6.5 10.2l2.4 2.4 4.6-4.8" /> : null}
    </svg>
  );
}

function tipOf(status: UpdateStatus, busy: boolean, blockers: readonly string[] | null): string {
  const version = status.available ?? '';
  if (blockers !== null && blockers.length > 0) return `下好了，还有${blockers.join('、')}，处理好再点一下重新打开`;
  switch (status.state) {
    case 'available': return busy ? '开始下载…' : `有新版本 ${version} · 点一下下载并更新`;
    case 'downloading': return `正在下载 · ${Math.round(updateFraction(status) * 100)}%`;
    case 'ready': return busy ? '下好了，正在重新打开' : `${version} 已下好 · 点一下重新打开`;
    case 'installing': return '下好了，正在重新打开';
    default: return `${status.problem ?? '更新没下成'} · 点一下重试`;
  }
}

export function UpdateButton(): ReactNode {
  // 壳的桥是 window 上同一个对象：每次渲染读一下（不记住），桥晚到时下一次渲染就接上。
  const shell = desktopShell();
  const status = useDesktopUpdate(shell);
  const api = useApi();
  const state = useClientState();
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<string[] | null>(null);
  if (shell === null || status === null || !updateVisible(status)) return null;
  const working = status.state === 'downloading' || status.state === 'installing';
  const failed = status.state === 'failed' && blockers === null;
  const press = (): void => {
    if (busy || working) return;
    setBusy(true);
    setBlockers(null);
    runDesktopUpdate(shell, api, state, status).then((outcome) => {
      setBlockers(outcome.kind === 'blocked' ? outcome.reasons : null);
    }, (cause: unknown) => {
      console.warn('更新没成', cause);
      setBlockers(null);
    }).finally(() => setBusy(false));
  };
  const tip = tipOf(status, busy, blockers);
  const ringing = working || status.state === 'ready' || (busy && status.state !== 'failed');
  return (
    <button type="button" className="rail-item rail-update" data-state={status.state} aria-label={tip}
      data-tip={tip} data-tip-side="right" aria-busy={working || busy ? 'true' : undefined} onClick={press}>
      {ringing ? <Ring fraction={updateFraction(status)}
        done={status.state === 'ready' || status.state === 'installing'} /> : <Icon name={failed ? 'refresh' : 'download'} size={18} />}
      {failed ? <span className="rail-dot rail-update-dot" aria-hidden="true" /> : null}
    </button>
  );
}
