// 第 12 批：主线的名字（11-12 Aaron 定：主线 AI 的名字可以自己起）。新名字用在栏目、主线那一行、引用署名、
// 输入框提示和它的自称；窗口标题、安装包、官网等产品名仍是 Plasticine。头像是泥团加漩涡，画风在这里换（11-13）。
// 第13批（设计稿 Editor）：编辑主线和编辑队友一个样子——头像、名字、Soul、模型；「换画风」点开才出画风格子。
// 名字和画风、Soul、模型分三处存，依次存，哪一步没存上就停在那一步、写原因，已经存上的不回滚。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import { createRequestId } from '../../api/request-id.ts';
import { ApiError } from '../../api/errors.ts';
import { DEFAULT_MATE_VARIANT, SOUL_OWNER_MAIN, type MateVariant } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import type { ChooserChange } from '../models/model-chooser.tsx';
import { LookChoices } from './bot/look-picker.tsx';
import { MainAvatar } from './mate-avatar.tsx';
import { useMainIdentity } from './main-store.ts';
import { MainModelField } from './model-field.tsx';
import { SoulField } from './soul-field.tsx';
import { useSoulDoc } from './use-soul-doc.ts';

export { useMainIdentity, useMainName } from './main-store.ts';

export function MainEditor({ phone, onClose }: { phone: boolean; onClose: () => void }): ReactNode {
  const live = useLive();
  const api = useApi();
  const current = useMainIdentity();
  const [draft, setDraft] = useState<{ name: string; variant: MateVariant }>(() => ({ name: current.name,
    variant: current.variant ?? DEFAULT_MATE_VARIANT }));
  const soul = useSoulDoc(SOUL_OWNER_MAIN);
  const [model, setModel] = useState<ChooserChange | null>(null);
  const [looking, setLooking] = useState(false);
  const [picked, setPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const name = draft.name.trim();
  const identityChanged = name !== current.name || draft.variant !== (current.variant ?? DEFAULT_MATE_VARIANT);
  /** 依次存名字和画风、Soul、模型；回第一处没存上的原因。 */
  const saveAll = async (): Promise<string | null> => {
    if (identityChanged) {
      try {
        await api.mates.updateMain({ requestId: createRequestId(), name, variant: draft.variant });
        await live.mates.reload();
      } catch (cause) {
        return cause instanceof ApiError ? cause.message : '名字和头像没有改成，再试一次。';
      }
    }
    const soulProblem = await soul.save();
    if (soulProblem !== null) return `Soul 没有存上：${soulProblem}`;
    const modelProblem = model === null ? null : await live.models.choosePurposes(['main'], model);
    return modelProblem === null ? null : `模型没有改成：${modelProblem}`;
  };
  const submit = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const failed = await saveAll();
    if (!mounted.current) return;
    setBusy(false);
    if (failed === null) onClose();
    else setProblem(failed);
  };
  return createPortal(<div className="mate-editor-layer"><Sheet open variant={phone ? 'drawer' : 'panel'} modal
    title="编辑主线" onClose={onClose} className="mate-editor-sheet soul-editor-sheet">
    <form className="mate-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy}>
        <div className="editor-look">
          <span className="editor-look-box"><MainAvatar key={draft.variant} variant={draft.variant} size={52}
            picked={picked} /></span>
          <div className="editor-look-side">
            <span className="mate-form-label">头像</span>
            <button type="button" className="secondary-button button-small" aria-expanded={looking}
              onClick={() => setLooking(!looking)}>换画风</button>
          </div>
        </div>
        {looking ? (
          <div className="look-grid look-grid-fit">
            <LookChoices kind="variant" look={{ kind: 'main', variant: draft.variant }}
              onChange={(variant) => { setPicked(true); setDraft({ ...draft, variant }); }} /></div>
        ) : null}
        <label>名字<input required minLength={2} maxLength={20} autoFocus value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <SoulField owner={SOUL_OWNER_MAIN} doc={soul} />
        <MainModelField pending={model} onPick={setModel} />
      </fieldset>
      {problem === null ? null : <p className="line-note" role="alert">{problem}</p>}
      <div className="mate-form-actions">
        <button type="button" className="secondary-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={busy || name.length < 2 || soul.loading
          || soul.error !== null || soul.text.trim().length < 2}>保存修改</button></div>
    </form>
  </Sheet></div>, document.body);
}
