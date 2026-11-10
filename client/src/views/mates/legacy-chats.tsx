import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { LegacyChatProposal } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { mainChatRoute, mateRoute, type Route } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { PendingOps } from '../pending/pending-ops.tsx';

export function LegacyChats({ phone, navigate, onClose }: { phone: boolean; navigate: (route: Route) => void;
  onClose: () => void }): ReactNode {
  const api = useApi();
  const live = useLive();
  const roster = useStore(live.mates.data);
  const [proposal, setProposal] = useState<LegacyChatProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [merge, setMerge] = useState(false);
  const prepare = async (lineId: string): Promise<void> => {
    setBusy(true); setError(null);
    try { setProposal(await api.mates.prepareLegacy(lineId)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const convert = async (action: 'mate' | 'merge'): Promise<void> => {
    if (proposal === null) return;
    setBusy(true);
    const result = await live.mateActions.convert({ lineId: proposal.lineId, action,
      ...(action === 'mate' ? { draft: proposal.draft } : {}) }, proposal.title);
    setBusy(false);
    if (result !== null && 'mate' in result) {
      onClose(); navigate(result.mate === null ? mainChatRoute() : mateRoute(result.mate.id));
    }
  };
  return createPortal(<div className="mate-editor-layer"><Sheet open modal variant={phone ? 'drawer' : 'panel'}
    title="整理原来的对话" onClose={onClose} className="mate-editor-sheet">
    <div className="mate-form">
      {busy && proposal === null ? <p role="status">正在整理这段对话…</p> : null}
      {proposal === null ? roster.legacyChats.map((chat) => <button key={chat.lineId} type="button"
        className="secondary-button" disabled={busy}
        onClick={() => { void prepare(chat.lineId); }}>{chat.title}</button>)
        : <><h3>{proposal.title}</h3><p>{proposal.reason}</p>
          <label>名字<input value={proposal.draft.name} onChange={(event) => setProposal({ ...proposal,
            draft: { ...proposal.draft, name: event.target.value } })} /></label>
          <label>职责<textarea value={proposal.draft.role} onChange={(event) => setProposal({ ...proposal,
            draft: { ...proposal.draft, role: event.target.value } })} /></label>
          <div className="mate-form-actions"><button type="button" className="secondary-button" disabled={busy}
            onClick={() => setMerge(true)}>并回主线</button>
            <button type="button" className="primary-button" disabled={busy || proposal.draft.name.trim().length < 2
              || proposal.draft.role.trim().length < 2} onClick={() => { void convert('mate'); }}>确认转成队友</button></div>
        </>}
      {error === null ? null : <p role="alert">{error}</p>}
      <PendingOps label="对话整理结果" prefixes={['mates:convert:']} visible={() => false}
        onRetry={(key) => {
          void live.mateActions.retry(key).then((result) => {
            if (result !== null && 'mate' in result) {
              onClose(); navigate(result.mate === null ? mainChatRoute() : mateRoute(result.mate.id));
            }
          });
        }} />
    </div>
  </Sheet>{merge ? <ConfirmDialog title="把记录并回主线？" body="原对话记录会并入主线历史并原样保留，原入口会收起。"
    confirmLabel="确认并回主线" busy={busy} onCancel={() => setMerge(false)}
    onConfirm={() => { void convert('merge'); }} /> : null}</div>, document.body);
}
