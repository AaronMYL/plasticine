// 第 12 批：主线的名字（11-12 Aaron 定：主线 AI 的名字可以自己起）。新名字用在栏目、主线那一行、引用署名、
// 输入框提示和它的自称；窗口标题、安装包、官网等产品名仍是 Plasticine。头像是泥团加漩涡，画风在这里换（11-13）。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import { createRequestId } from '../../api/request-id.ts';
import { ApiError } from '../../api/errors.ts';
import { DEFAULT_MATE_VARIANT, type MateVariant } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { LookChoices } from './bot/look-picker.tsx';
import { MainAvatar } from './mate-avatar.tsx';
import { useMainIdentity } from './main-store.ts';

export { useMainIdentity, useMainName } from './main-store.ts';

export function MainEditor({ phone, onClose }: { phone: boolean; onClose: () => void }): ReactNode {
  const live = useLive();
  const api = useApi();
  const current = useMainIdentity();
  const [draft, setDraft] = useState<{ name: string; variant: MateVariant }>(() => ({ name: current.name,
    variant: current.variant ?? DEFAULT_MATE_VARIANT }));
  const [picked, setPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const name = draft.name.trim();
  const submit = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await api.mates.updateMain({ requestId: createRequestId(), name, variant: draft.variant });
      await live.mates.reload();
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current) setProblem(cause instanceof ApiError ? cause.message : '没有改成，再试一次。');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return createPortal(<div className="mate-editor-layer"><Sheet open variant={phone ? 'drawer' : 'panel'} modal
    title="编辑主线" onClose={onClose} className="mate-editor-sheet">
    <form className="mate-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy}>
        <div className="mate-form-identity mate-form-look">
          <MainAvatar key={draft.variant} variant={draft.variant} size={56} picked={picked} />
          <div className="mate-form-look-side">
            <span className="mate-form-label">画风</span>
            <div className="look-grid look-grid-fit">
              <LookChoices kind="variant" look={{ kind: 'main', variant: draft.variant }}
                onChange={(variant) => { setPicked(true); setDraft({ ...draft, variant }); }} /></div></div></div>
        <label>名字<input required minLength={2} maxLength={20} autoFocus value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      </fieldset>
      {problem === null ? null : <p className="line-note" role="alert">{problem}</p>}
      <div className="mate-form-actions">
        <button type="button" className="secondary-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={busy || name.length < 2}>保存修改</button></div>
    </form>
  </Sheet></div>, document.body);
}
