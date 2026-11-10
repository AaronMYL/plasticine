import { useCallback, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SpaceView } from '../../api/shared.ts';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { useRead } from '../memory/use-read.ts';
import './space-versions.css';

export function SpaceVersions({ space, phone, onClose, onSelect, onChanged }: {
  space: SpaceView;
  phone: boolean;
  onClose: () => void;
  onSelect: (version: number) => void;
  onChanged: (space: SpaceView) => void;
}): ReactNode {
  const api = useApi();
  const read = useCallback((signal: AbortSignal) => api.spaces.versions(space.id, undefined, signal), [api, space.id]);
  const { value, error, reload } = useRead(read);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const latest = value?.versions[0]?.version ?? space.version;
  const undo = (): void => {
    setBusy(true);
    setFailure(null);
    void api.spaces.undo(space.id, { requestId: createRequestId(), version: latest }).then((next) => {
      onChanged(next);
      reload();
    }, (cause: unknown) => setFailure(errorText(cause))).finally(() => setBusy(false));
  };
  return <Sheet open title="版本记录" variant={phone ? 'drawer' : 'panel'} onClose={onClose}>
    <div className="space-version-list">
      {error === null && failure === null ? null : <p role="alert" className="is-error">{failure ?? error}
        <button className="text-button" type="button" onClick={reload}>重新读取</button></p>}
      {latest < 2 ? null : <button type="button" className="text-button" disabled={busy} onClick={undo}>
        撤销上次修改</button>}
      {value?.versions.map((revision) => <button type="button" className="space-version-row" key={revision.version}
        aria-label={`查看第 ${revision.version} 版`} onClick={() => onSelect(revision.version)}>
        <span>{`第 ${revision.version} 版`}</span>
        <span className="text-meta">{revision.change ?? (revision.author === 'ai' ? 'Plasticine 写的' : '修改正文')}</span>
      </button>)}
    </div>
  </Sheet>;
}
