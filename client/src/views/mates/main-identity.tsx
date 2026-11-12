// 第 12 批：主线的名字、头像字、颜色（11-12 Aaron 定：主线 AI 的名字可以自己起）。编辑和编辑队友同一个弹框，
// 少「职责」。新名字用在栏目、主线那一行、引用署名、输入框提示和它的自称；窗口标题、安装包、官网等产品名仍是 Plasticine。
// 头像字没起时画 Plasticine 的标。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import { createRequestId } from '../../api/request-id.ts';
import { ApiError } from '../../api/errors.ts';
import { DEFAULT_MAIN, PROJECT_HUES, type MainIdentity } from '../../api/shared.ts';
import { useLive, useOptionalLive } from '../../live.tsx';
import { Store } from '../../state/store.ts';
import { HueSwatches } from '../../primitives/hue-swatches/index.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { HUE_NAMES } from '../../shell/hue.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { useStore } from '../../state/use-store.ts';
import { MateAvatar } from './mate-avatar.tsx';
import type { MatesData } from './mates-store.ts';

const NO_MATES = new Store<MatesData>({ status: 'idle', error: null, mates: [], groups: [], legacyChats: [] });

/** 主线现在叫什么；不在 LiveProvider 里（单独画的对话部件）时照旧是 Plasticine。 */
export function useMainIdentity(): MainIdentity {
  const live = useOptionalLive();
  return useStore(live?.mates.data ?? NO_MATES).main ?? DEFAULT_MAIN;
}

export function useMainName(): string {
  return useMainIdentity().name;
}

export function MainAvatar({ main, size = 28 }: { main: MainIdentity; size?: number }): ReactNode {
  if (main.avatar === null) return <PlasticineMark size={size} />;
  return <MateAvatar mate={{ avatar: main.avatar, hue: main.hue ?? 'sky' }} size={size} />;
}

export function MainEditor({ phone, onClose }: { phone: boolean; onClose: () => void }): ReactNode {
  const live = useLive();
  const api = useApi();
  const current = useMainIdentity();
  const [draft, setDraft] = useState<MainIdentity>(current);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const name = draft.name.trim();
  const submit = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await api.mates.updateMain({ requestId: createRequestId(), name, avatar: draft.avatar, hue: draft.hue });
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
        <div className="mate-form-identity"><MainAvatar main={draft} size={44} />
          <label>头像文字<input value={draft.avatar ?? ''} maxLength={8} placeholder="不填用 Plasticine 的标"
            onChange={(event) => setDraft({ ...draft, avatar: event.target.value === '' ? null : event.target.value,
              hue: draft.hue ?? 'sky' })} /></label>
          <div className="mate-form-hue"><span className="mate-form-label">颜色</span>
            <HueSwatches label="颜色" hues={PROJECT_HUES} names={HUE_NAMES} value={draft.hue ?? 'sky'}
              onChange={(hue) => setDraft({ ...draft, hue })} /></div></div>
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
