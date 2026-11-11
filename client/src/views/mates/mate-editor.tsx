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
        <div className="mate-form-identity"><MateAvatar mate={draft} size={44} />
          <label>头像文字<input value={draft.avatar} maxLength={8}
            onChange={(event) => patch('avatar', event.target.value)} /></label>
          <div className="mate-form-hue"><span className="mate-form-label">颜色</span>
            <HueSwatches label="颜色" hues={PROJECT_HUES} names={HUE_NAMES} value={draft.hue}
              onChange={(hue) => patch('hue', hue)} /></div></div>
        <label>名字<input required minLength={2} maxLength={40} autoFocus value={draft.name}
          onChange={(event) => patch('name', event.target.value)} /></label>
        <label>职责<textarea required minLength={2} maxLength={160} rows={3} value={draft.role}
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
