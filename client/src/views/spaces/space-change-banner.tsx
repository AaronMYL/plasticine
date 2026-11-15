// 这一期刚改好（第 6 条）：Plasticine 刚改过这一期——「这一期改好了：…… 以后都这样 / 撤销」。「以后都这样」写进订阅设置，
// 「撤销」恢复上一版。网页版和旧版式的空间共用。
// 11-14 界面统一（Aaron 弹框定「提示条只留一种、最多一个动作」）：这条有两个动作，改成内容最上面的页内横条，不再自己收；
// 关掉、或者打开过一次就不再出；十分钟前的修改不出。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SpaceView } from '../../api/shared.ts';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';

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
    console.warn('修改提示的已读记录没读到，本次仍显示提示', cause);
    return true;
  }
}

export function ChangeBanner({ space, onChanged }: { space: SpaceView; onChanged: (next: SpaceView | null) => void }):
  ReactNode {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(() => !shouldShow(space));
  const change = space.lastChange;
  const key = seenKey(space);
  useEffect(() => {
    if (closed) return;
    try {
      window.localStorage.setItem(key, '1');
    } catch (cause) {
      console.warn('修改提示的已读记录没能保存，下次打开可能再次显示', cause);
    }
  }, [key, closed]);
  if (change === null || change.adopted || closed) {
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
    <div className="banner space-change" role={error === null ? 'status' : 'alert'}>
      <StatusGlyph status="done" label="改好了" />
      <span className="banner-text">{error ?? `这一期改好了：${change.change}`}</span>
      {change.rule !== null && space.subscription !== null ? (
        <button type="button" className="text-button" disabled={busy} onClick={adopt}
          data-tip={`以后每期：${change.rule}`}>以后都这样</button>
      ) : null}
      <button type="button" className="text-button" disabled={busy} onClick={undo}>撤销</button>
      <IconButton icon="close" label="关掉" onClick={() => setClosed(true)} />
    </div>
  );
}
