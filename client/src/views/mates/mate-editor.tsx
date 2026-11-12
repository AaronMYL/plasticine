import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MODEL_PURPOSES, PROJECT_HUES, type MateDraft, type MateView, type MateGroupView,
  type MateGroupDraft } from '../../api/shared.ts';
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
import { MateAvatar } from './mate-avatar.tsx';

export const EMPTY_MATE: MateDraft = { name: '', role: '', avatar: '友', hue: 'sky', purpose: null, soul: '' };

/**
 * 新建队友时的几个现成起点（11-12，Aaron：「让配置更直观」）：点一个填好名字、职责、头像字和颜色，再照自己的事改。
 * 职责写成「管什么、交回什么」，主线分派和队友自己都照它判断这件事归不归它。
 */
export const MATE_PRESETS: readonly Pick<MateDraft, 'name' | 'role' | 'avatar' | 'hue'>[] = [
  { name: '资料研究员', avatar: '研', hue: 'sky', role: '查公开资料、读原文、核对来源；交回带出处的要点，分清哪些是事实、哪些是推测。' },
  { name: '文字编辑', avatar: '编', hue: 'rose', role: '改稿、润色、统一说法和格式；交回改好的稿子和改了什么。不改事实和结论。' },
  { name: '日程管家', avatar: '程', hue: 'teal', role: '看日历、待办和到期的事，排时间、提醒、准备会前材料；要对外回复或改日程先问。' },
  { name: '代码助手', avatar: '码', hue: 'slate', role: '读代码、查问题、写脚本和小工具；交回能跑的结果、怎么验证的、没验证的部分。' },
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
  const locked = op !== undefined && isOpenOp(op);
  const patch = <K extends keyof MateDraft>(field: K, value: MateDraft[K]): void => {
    setDraft((old) => ({ ...old, [field]: value }));
  };
  const submit = async (): Promise<void> => {
    const body: MateDraft = { name: draft.name.trim(), avatar: draft.avatar.trim() || draft.name.slice(0, 1),
      hue: draft.hue, role: draft.role.trim(), soul: draft.soul, purpose: draft.purpose };
    const result = mate === undefined ? await live.mateActions.create(body) : await live.mateActions.update(mate, body);
    if (mounted.current && result !== null && 'role' in result) { onClose(); navigate(mateRoute(result.id)); }
  };
  const title = mate === undefined ? '创建队友' : '编辑队友';
  return createPortal(<div className="mate-editor-layer"><Sheet open variant={phone ? 'drawer' : 'panel'} modal
    title={title} onClose={onClose} className="mate-editor-sheet">
    <form className="mate-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={locked}>
        {mate !== undefined ? null : (
          <div className="mate-presets" role="group" aria-label="从一个现成的开始">
            {MATE_PRESETS.map((preset) => (
              <button key={preset.name} type="button" className="mate-preset"
                aria-pressed={draft.name === preset.name && draft.role === preset.role}
                onClick={() => setDraft((old) => ({ ...old, ...preset }))}>
                <MateAvatar mate={preset} size={24} />{preset.name}
              </button>
            ))}
          </div>
        )}
        <div className="mate-form-identity"><MateAvatar mate={draft} size={44} />
          <label>头像文字<input value={draft.avatar} maxLength={8}
            onChange={(event) => patch('avatar', event.target.value)} /></label>
          <div className="mate-form-hue"><span className="mate-form-label">颜色</span>
            <HueSwatches label="颜色" hues={PROJECT_HUES} names={HUE_NAMES} value={draft.hue}
              onChange={(hue) => patch('hue', hue)} /></div></div>
        <label>名字<input required minLength={2} maxLength={40} autoFocus value={draft.name}
          onChange={(event) => patch('name', event.target.value)} /></label>
        <label>职责<textarea required minLength={2} maxLength={160} rows={3} value={draft.role}
          placeholder="管什么事、做完交回什么。比如：查公开资料、核对来源，交回带出处的要点。"
          onChange={(event) => patch('role', event.target.value)} /></label>
        <label>模型配置<select value={draft.purpose ?? ''}
          onChange={(event) => patch('purpose', (event.target.value || null) as MateDraft['purpose'])}>
          <option value="">跟主线</option>
          {MODEL_PURPOSES.map((purpose) => <option key={purpose.id} value={purpose.id}>{purpose.label}</option>)}
        </select></label>
      </fieldset>
      {op === undefined ? null : <OpLine op={op} onRetry={() => {
        void live.mateActions.retry(key).then((result) => {
          if (mounted.current && result !== null && 'role' in result) { onClose(); navigate(mateRoute(result.id)); }
        });
      }}
        onDismiss={() => state.actionOps.dismiss(key)} />}
      <div className="mate-form-actions">
        <button type="button" className="secondary-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={locked || draft.name.trim().length < 2
          || draft.role.trim().length < 2}>{mate === undefined ? '创建队友' : '保存修改'}</button></div>
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
              : draft.mateIds.filter((id) => id !== mate.id) })} /><MateAvatar mate={mate} />{mate.name}</label>
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
