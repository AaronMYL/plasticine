import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_MATE_CHARACTER, DEFAULT_MATE_FACE, DEFAULT_MATE_VARIANT, mateRoleOf, mateSoulOpening, PROJECT_HUES,
  type MateDraft, type MateView, type MateGroupView, type MateGroupDraft } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { HueSwatches } from '../../primitives/hue-swatches/index.tsx';
import { HUE_NAMES } from '../../shell/hue.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { mateGroupRoute, mateRoute, type Route } from '../../shell/routes.ts';
import { useOp } from '../pending/pending-ops.tsx';
import { LookGrid, LookTabs, type LookTab } from './bot/look-picker.tsx';
import type { MateActions } from './mate-actions.ts';
import { MateAvatar } from './mate-avatar.tsx';
import { MateModelField } from './model-field.tsx';
import { SoulField } from './soul-field.tsx';
import { useSoulDoc } from './use-soul-doc.ts';

export const EMPTY_MATE: MateDraft = { name: '', role: '', avatar: DEFAULT_MATE_CHARACTER, hue: 'sky',
  variant: DEFAULT_MATE_VARIANT, face: DEFAULT_MATE_FACE, purpose: null, soul: '' };

/**
 * 新建队友时的几个现成起点（11-12，Aaron：「让配置更直观」）：点一个填好名字、职责、头像角色和颜色，再照自己的事改。
 * 职责写成「管什么、交回什么」，主线分派和队友自己都照它判断这件事归不归它。
 */
export const MATE_PRESETS: readonly Pick<MateDraft, 'name' | 'role' | 'avatar' | 'hue'>[] = [
  { name: '资料研究员', avatar: 'cat', hue: 'sky', role: '查公开资料、读原文、核对来源；交回带出处的要点，分清哪些是事实、哪些是推测。' },
  { name: '文字编辑', avatar: 'bunny', hue: 'rose', role: '改稿、润色、统一说法和格式；交回改好的稿子和改了什么。不改事实和结论。' },
  { name: '日程管家', avatar: 'bell', hue: 'teal', role: '看日历、待办和到期的事，排时间、提醒、准备会前材料；要对外回复或改日程先问。' },
  { name: '代码助手', avatar: 'bot', hue: 'slate', role: '读代码、查问题、写脚本和小工具；交回能跑的结果、怎么验证的、没验证的部分。' },
];
type Props = { phone: boolean; onClose: () => void; navigate: (route: Route) => void };

export function MateEditor({ mate, phone, onClose, navigate }: Props & { mate?: MateView }): ReactNode {
  const live = useLive();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = useClientState();
  const key = mate === undefined ? 'mates:create' : `mates:update:${mate.id}`;
  const op = useOp(key);
  const cached = op?.request;
  const [draft, setDraft] = useState<MateDraft>(() => ({ ...EMPTY_MATE, ...mate,
    ...(cached?.kind === 'mate_create' || cached?.kind === 'mate_update' ? cached.body : {}) }));
  // 第13批：职责不再单独填，Soul 第一段就是（「你是我的……：管什么」）；新建时 Soul 跟着建，改的时候另存一份。
  const soul = useSoulDoc(mate?.id ?? null, cached?.kind === 'mate_create' ? cached.body.soul : '');
  const [problem, setProblem] = useState<string | null>(null);
  const locked = op !== undefined && isOpenOp(op);
  const [picked, setPicked] = useState(false);
  const [lookTab, setLookTab] = useState<LookTab | null>(null);
  const patch = <K extends keyof MateDraft>(field: K, value: MateDraft[K]): void => {
    setDraft((old) => ({ ...old, [field]: value }));
  };
  const finish = async (result: Awaited<ReturnType<MateActions['create']>>): Promise<void> => {
    if (!mounted.current || result === null || !('role' in result)) return;
    const failed = await soul.save();
    if (!mounted.current) return;
    setProblem(failed);
    if (failed === null) { onClose(); navigate(mateRoute(result.id)); }
  };
  const submit = async (): Promise<void> => {
    setProblem(null);
    const name = draft.name.trim();
    const derived = mateRoleOf(name, soul.text);
    const role = Array.from(derived).length >= 2 ? derived : mate?.role ?? name;
    const changes = { name, avatar: draft.avatar, hue: draft.hue, variant: draft.variant ?? DEFAULT_MATE_VARIANT,
      face: draft.face ?? DEFAULT_MATE_FACE, role, purpose: draft.purpose };
    await finish(mate === undefined ? await live.mateActions.create({ ...changes, soul: soul.text.trim() })
      : await live.mateActions.update(mate, changes));
  };
  const title = mate === undefined ? '创建队友' : '编辑队友';
  return createPortal(<div className="mate-editor-layer"><Sheet open variant={phone ? 'drawer' : 'panel'} modal
    title={title} onClose={onClose} className="mate-editor-sheet soul-editor-sheet">
    <form className="mate-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={locked}>
        {mate !== undefined ? null : (
          <div className="mate-presets" role="group" aria-label="从一个现成的开始">
            {MATE_PRESETS.map((preset) => (
              <button key={preset.name} type="button" className="mate-preset"
                aria-pressed={draft.name === preset.name && soul.text === mateSoulOpening(preset.name, preset.role)}
                onClick={() => {
                  setDraft((old) => ({ ...old, ...preset }));
                  soul.setText(mateSoulOpening(preset.name, preset.role));
                }}>
                <MateAvatar mate={preset} size={24} still />{preset.name}
              </button>
            ))}
          </div>
        )}
        <div className="editor-look">
          {/* 换了角色、画风、脸型或颜色弹一下：重新挂上，做完的那一下（11-13 设计稿）。 */}
          <span className="editor-look-box">
            <MateAvatar key={`${draft.avatar}:${draft.hue}:${draft.variant}:${draft.face}`} mate={draft} size={52}
              picked={picked} /></span>
          <div className="editor-look-side">
            <LookTabs tab={lookTab} onTab={setLookTab} />
            <HueSwatches label="颜色" hues={PROJECT_HUES} names={HUE_NAMES} value={draft.hue}
              onChange={(hue) => { setPicked(true); patch('hue', hue); }} /></div></div>
        {lookTab === null ? null : <LookGrid tab={lookTab} look={{ avatar: draft.avatar, hue: draft.hue,
          variant: draft.variant ?? DEFAULT_MATE_VARIANT, face: draft.face ?? DEFAULT_MATE_FACE }}
          onChange={(change) => { setPicked(true); setDraft((old) => ({ ...old, ...change })); }} />}
        <label>名字<input required minLength={2} maxLength={40} autoFocus value={draft.name}
          onChange={(event) => patch('name', event.target.value)} /></label>
        <SoulField owner={mate?.id ?? null} doc={soul}
          placeholder={'你是我的……：管什么事、做完交回什么。\n\n## 说话\n- 先说结论，再说依据。'} />
        <MateModelField purpose={draft.purpose} onChange={(purpose) => patch('purpose', purpose)} />
      </fieldset>
      {op === undefined ? null : <OpLine op={op}
        onRetry={() => { void live.mateActions.retry(key).then(finish); }}
        onDismiss={() => state.actionOps.dismiss(key)} />}
      {problem === null ? null : <p className="line-note" role="alert">Soul 没有存上：{problem}</p>}
      <div className="mate-form-actions">
        <button type="button" className="secondary-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={locked || soul.loading || soul.error !== null
          || draft.name.trim().length < 2 || soul.text.trim().length < 2}>
          {mate === undefined ? '创建队友' : '保存修改'}</button></div>
    </form>
  </Sheet></div>, document.body);
}

export function GroupEditor({ group, phone, onClose, navigate }: Props & { group?: MateGroupView }): ReactNode {
  const live = useLive();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = useClientState();
  const roster = useStore(live.mates.data);
  const key = group === undefined ? 'mate-groups:create' : `mate-groups:update:${group.id}`;
  const op = useOp(key);
  const cached = op?.request;
  const [draft, setDraft] = useState<MateGroupDraft>(() => ({ name: group?.name ?? '', mateIds: group?.mateIds ?? [],
    ...(cached?.kind === 'mate_group_create' || cached?.kind === 'mate_group_update' ? cached.body : {}) }));
  const locked = op !== undefined && isOpenOp(op);
  const submit = async (): Promise<void> => {
    const body = { name: draft.name.trim(), mateIds: [...draft.mateIds] };
    const result = group === undefined ? await live.mateActions.createGroup(body)
      : await live.mateActions.updateGroup(group, body);
    if (mounted.current && result !== null && 'mateIds' in result) { onClose(); navigate(mateGroupRoute(result.id)); }
  };
  return createPortal(<div className="mate-editor-layer"><Sheet open variant={phone ? 'drawer' : 'panel'} modal
    title={group === undefined ? '创建群组' : '编辑群组'} onClose={onClose} className="mate-editor-sheet">
    <form className="mate-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={locked}><label>群组名字<input required minLength={2} maxLength={60} value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <legend className="sr-only">选择队友</legend>
        <p className="mate-form-caption">选择 2–6 位队友</p>
        {roster.mates.filter((mate) => mate.disabledAt === null || draft.mateIds.includes(mate.id)).map((mate) => (
          <label key={mate.id} className="mate-check"><input type="checkbox" checked={draft.mateIds.includes(mate.id)}
            disabled={!draft.mateIds.includes(mate.id) && (mate.disabledAt !== null || draft.mateIds.length >= 6)}
            onChange={(event) => setDraft({ ...draft, mateIds: event.target.checked ? [...draft.mateIds, mate.id]
              : draft.mateIds.filter((id) => id !== mate.id) })} /><MateAvatar mate={mate} still />{mate.name}</label>
        ))}
      </fieldset>
      {op === undefined ? null : <OpLine op={op} onRetry={() => {
        void live.mateActions.retry(key).then((result) => {
          if (mounted.current && result !== null && 'mateIds' in result) {
            onClose(); navigate(mateGroupRoute(result.id));
          }
        });
      }}
        onDismiss={() => state.actionOps.dismiss(key)} />}
      <div className="mate-form-actions">
        <button type="button" className="secondary-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={locked || draft.name.trim().length < 2
          || draft.mateIds.length < 2}>
          {group === undefined ? '创建群组' : '保存修改'}</button></div>
    </form>
  </Sheet></div>, document.body);
}
