// 页底那一条（第 6 条）：Plasticine 刚改过这一期——「这一期改好了：…… 以后都这样 / 撤销」。「以后都这样」写进订阅设置，
// 「撤销」恢复上一版。网页版和旧版式的空间共用。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SpaceView } from '../../api/shared.ts';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';

export function ChangeToast({ space, onChanged }: { space: SpaceView; onChanged: (next: SpaceView | null) => void }):
  ReactNode {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const change = space.lastChange;
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
    <div className="space-toast" role="status">
      <StatusGlyph status="done" label="改好了" />
      <span className="grow">{error ?? `这一期改好了：${change.change}`}</span>
      {change.rule !== null && space.subscription !== null ? (
        <button type="button" className="secondary-button space-toast-button" disabled={busy} onClick={adopt}
          data-tip={`以后每期：${change.rule}`}>以后都这样</button>
      ) : null}
      <button type="button" className="text-button text-button-quiet" disabled={busy} onClick={undo}>撤销</button>
      <IconButton icon="close" label="收起" onClick={() => setKept(true)} />
    </div>
  );
}
