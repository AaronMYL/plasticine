import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MateGroupView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { useOp } from '../pending/pending-ops.tsx';

export function MateGroupTaskEditor({ group, phone, onClose }: { group: MateGroupView;
  phone: boolean; onClose: () => void }): ReactNode {
  const live = useLive();
  const state = useClientState();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const key = `mate-groups:task:create:${group.id}`;
  const op = useOp(key);
  const [text, setText] = useState(op?.request.kind === 'mate_group_task_create' ? op.request.body.text : '');
  const locked = op !== undefined && isOpenOp(op);
  const submit = async (): Promise<void> => {
    const result = await live.mateActions.createTask(group.id, text.trim());
    if (mounted.current && result !== null) onClose();
  };
  return createPortal(<div className="mate-editor-layer"><Sheet open variant={phone ? 'drawer' : 'panel'} modal
    title="发布群任务" onClose={onClose} className="mate-editor-sheet">
    <form className="mate-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>任务内容<textarea autoFocus rows={6} value={text} disabled={locked}
        onChange={(event) => setText(event.target.value)} /></label>
      <div className="mate-form-actions"><button type="button" className="secondary-button" onClick={onClose}>
        取消</button><button type="submit" className="primary-button" disabled={locked || text.trim() === ''}>
        发布任务</button></div>
      {op === undefined ? null : <OpLine op={op} onDismiss={(id) => state.actionOps.dismiss(id)}
        onRetry={(id) => { void live.mateActions.retry(id).then((result) => {
          if (mounted.current && result !== null) onClose();
        }); }} />}
    </form>
  </Sheet></div>, document.body);
}
