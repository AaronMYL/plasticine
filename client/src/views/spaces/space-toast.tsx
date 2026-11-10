// 页底那一条（第 6 条）：Plasticine 刚改过这一期——「这一期改好了：…… 以后都这样 / 撤销」。「以后都这样」写进订阅设置，
// 「撤销」恢复上一版。网页版和旧版式的空间共用。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SpaceView } from '../../api/shared.ts';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';

/** 修改提示只留六秒，十分钟前的修改不打断当前阅读。 */
const SHOW_MS = 6000;
const RECENT_MS = 10 * 60_000;

function seenKey(space: SpaceView): string {
  return `space-change-seen:${space.id}:${space.lastChange?.version ?? space.version}`;
}

function shouldShow(space: SpaceView): boolean {
  if (space.lastChange === null || space.lastChange.adopted) return false;
  const updated = Date.parse(space.updatedAt);
  if (!Number.isFinite(updated) || Date.now() - updated > RECENT_MS) return false;
  try {
    return window.localStorage.getItem(seenKey(space)) === null;
  } catch (cause) {
    console.warn('修改提示的已读记录读不出来，本次仍显示提示', cause);
    return true;
  }
}

export function ChangeToast({ space, onChanged }: { space: SpaceView; onChanged: (next: SpaceView | null) => void }):
  ReactNode {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(() => !shouldShow(space));
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(SHOW_MS);
  const change = space.lastChange;
  const paused = hovered || focused || busy || error !== null;
  const key = seenKey(space);
  useEffect(() => {
    if (kept) return;
    try {
      window.localStorage.setItem(key, '1');
    } catch (cause) {
      console.warn('修改提示的已读记录没能保存，下次打开可能再次显示', cause);
    }
  }, [key, kept]);
  useEffect(() => {
    if (kept || paused) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => setKept(true), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [kept, paused]);
  if (change === null || change.adopted || kept) {
    return null;
  }
  const act = (work: () => Promise<SpaceView | null>): void => {
    setBusy(true);
    setError(null);
    void work().then(onChanged, (cause: unknown) => setError(errorText(cause))).finally(() => setBusy(false));
  };
  const adopt = (): void => act(async () => {
    const subscription = space.subscription;
    if (subscription === null) {
      return null;
    }
    await api.subscriptions.adoptRule(subscription.id, { requestId: createRequestId(), version: subscription.version,
      spaceId: space.id, spaceVersion: change.version });
    return null;
  });
  const undo = (): void => act(() => api.spaces.undo(space.id, { requestId: createRequestId(),
    version: space.version }));
  return (
    <div className="space-toast" role="status" onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}>
      <StatusGlyph status="done" label="改好了" />
      <span className="grow">{error ?? `这一期改好了：${change.change}`}</span>
      {change.rule !== null && space.subscription !== null ? (
        <button type="button" className="secondary-button space-toast-button" disabled={busy} onClick={adopt}
          data-tip={`以后每期：${change.rule}`}>以后都这样</button>
      ) : null}
      <button type="button" className="text-button text-button-quiet" disabled={busy} onClick={undo}>撤销</button>
      <IconButton icon="close" label="收起" onClick={() => setKept(true)} />
      <span className="space-toast-countdown" aria-hidden="true" style={{ animationDuration: `${SHOW_MS}ms`,
        animationPlayState: paused ? 'paused' : 'running' }} />
    </div>
  );
}
