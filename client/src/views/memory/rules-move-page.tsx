import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SOUL_OWNER_MAIN, type RulesMoveDest, type RulesMoveItem, type RulesMoveResponse } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PickAll, PickBar } from '../bulk/pick-controls.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import type { Route } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { MainAvatar, MateAvatar } from '../mates/mate-avatar.tsx';
import { intoSoul, soulOf } from '../mates/soul-name.ts';
import { RULE_SOURCE_LABELS } from './rule-parts.tsx';
import { useRulesMove } from './use-rules-move.ts';
import './rules-move.css';

const SHOWN_PER_GROUP = 5;

interface Choice { on: boolean; dest: RulesMoveDest }

const destKey = (dest: RulesMoveDest): string => dest.kind === 'soul' ? `soul:${dest.owner ?? SOUL_OWNER_MAIN}`
  : dest.kind;
const destOf = (key: string): RulesMoveDest => key.startsWith('soul:') ? { kind: 'soul', owner: key.slice(5) }
  : { kind: key === 'product' ? 'product' : 'about_you', owner: null };

function ownerName(data: RulesMoveResponse, owner: string): string {
  return data.owners.find((item) => item.owner === owner)?.name ?? '队友';
}

function destLabel(data: RulesMoveResponse, key: string): string {
  return key === 'about_you' ? '关于你' : key === 'product' ? '隐私与授权' : soulOf(ownerName(data, key.slice(5)));
}

function GroupHead({ data, groupKey }: { data: RulesMoveResponse; groupKey: string }): ReactNode {
  const live = useLive();
  const mates = useStore(live.mates.data).mates;
  if (groupKey === 'about_you') {
    return <><h2 className="block-title">进「关于你」</h2>
      <span className="text-meta">你说过的偏好，主线和队友都照着做</span></>;
  }
  if (groupKey === 'product') {
    return <><h2 className="block-title">留在产品里</h2>
      <span className="text-meta">搬走后在「设置 · 隐私与授权」里看、改</span></>;
  }
  const owner = groupKey.slice(5);
  const mate = mates.find((item) => item.id === owner);
  return <>
    {owner === SOUL_OWNER_MAIN ? <MainAvatar size={20} still /> : mate === undefined ? null
      : <MateAvatar mate={mate} size={20} still />}
    <h2 className="block-title">{intoSoul(ownerName(data, owner))}</h2>
    {owner === SOUL_OWNER_MAIN ? <span className="text-meta">说话方式和相处中形成的判断</span> : null}
  </>;
}

function MoveRow({ item, data, pick, onPick }: { item: RulesMoveItem; data: RulesMoveResponse; pick: Choice;
  onPick: (pick: Choice) => void }): ReactNode {
  const key = destKey(pick.dest);
  const text = item.moved;
  return (
    <li className="move-item" data-on={pick.on}>
      <label className="move-item-main">
        <input type="checkbox" checked={pick.on} onChange={(event) => onPick({ ...pick, on: event.target.checked })} />
        <span className="move-item-text">{text}</span>
      </label>
      <span className="move-item-source">{RULE_SOURCE_LABELS[item.source]}</span>
      <span className="move-dest">
        <span aria-hidden="true">{destLabel(data, key)}</span>
        <Icon name="chevron-down" size={14} />
        <select aria-label={`「${item.text}」搬到哪里`} value={key}
          onChange={(event) => onPick({ on: true, dest: destOf(event.target.value) })}>
          <option value="about_you">关于你</option>
          {data.owners.map((owner) => (
            <option key={owner.owner} value={`soul:${owner.owner}`}>{soulOf(owner.name)}</option>
          ))}
          <option value="product">隐私与授权（拿掉）</option>
        </select>
      </span>
    </li>
  );
}

function MoveGroup({ data, groupKey, items, picks, onPick }: { data: RulesMoveResponse; groupKey: string;
  items: readonly RulesMoveItem[]; picks: ReadonlyMap<string, Choice>; onPick: (id: string, pick: Choice) => void }):
  ReactNode {
  const [open, setOpen] = useState(items.length <= SHOWN_PER_GROUP + 1);
  const shown = open ? items : items.slice(0, SHOWN_PER_GROUP);
  return (
    <section className="move-group" aria-label={destLabel(data, groupKey)}>
      <div className="move-group-head"><GroupHead data={data} groupKey={groupKey} /></div>
      <ul className="move-list">
        {shown.map((item) => <MoveRow key={item.id} item={item} data={data}
          pick={picks.get(item.id) ?? { on: item.suggested, dest: item.dest }}
          onPick={(pick) => onPick(item.id, pick)} />)}
      </ul>
      {open ? null : (
        <button type="button" className="move-more" onClick={() => setOpen(true)}>
          还有 {items.length - shown.length} 条
        </button>
      )}
    </section>
  );
}

function groupsOf(data: RulesMoveResponse): { key: string; items: RulesMoveItem[] }[] {
  const order = ['about_you', ...data.owners.map((owner) => `soul:${owner.owner}`), 'product'];
  return order.map((key) => ({ key, items: data.items.filter((item) => destKey(item.dest) === key) }))
    .filter((group) => group.items.length > 0);
}

export function RulesMovePage({ navigate, onBack }: { navigate: (route: Route) => void;
  onBack?: (() => void) | undefined }): ReactNode {
  const move = useRulesMove();
  const [picks, setPicks] = useState<ReadonlyMap<string, Choice>>(new Map());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const data = move.data;
  useEffect(() => {
    if (data === null) return;
    setPicks((old) => new Map(data.items.map((item) => [item.id, old.get(item.id)
      ?? { on: item.suggested, dest: item.dest }])));
  }, [data]);
  const groups = useMemo(() => data === null ? [] : groupsOf(data), [data]);
  const chosen = data?.items.filter((item) => picks.get(item.id)?.on ?? item.suggested) ?? [];
  const back = (): void => { if (onBack === undefined) navigate({ view: 'memory', noteId: null }); else onBack(); };
  const submit = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    const result = await move.apply(chosen.map((item) => ({ id: item.id, version: item.version,
      dest: picks.get(item.id)?.dest ?? item.dest })));
    setBusy(false);
    setNote(typeof result === 'string' ? { text: `没有搬成：${result}`, error: true }
      : { text: `搬好了 ${result.moved} 条${result.remaining > 0 ? `，还有 ${result.remaining} 条留在原处` : ''}。`,
        error: false });
  };
  const setAll = (on: boolean): void => setPicks((old) => new Map([...old].map(([id, pick]) => [id, { ...pick, on }])));
  return (
    <div className="page memory-rules-move">
      <PageHeader title="规则搬家" count={data === null || data.items.length === 0 ? undefined : data.items.length}
        onBack={back} />
      {move.error === null ? null : <p className="block-empty is-error" role="alert">{move.error}{' '}
        <button type="button" className="text-button" onClick={move.reload}>再读一次</button></p>}
      {note === null ? null : <p className={`block-empty${note.error ? ' is-error' : ''}`}
        role={note.error ? 'alert' : 'status'}>{note.text}</p>}
      {data === null ? (move.error === null ? <PageLoading rows={6} dense /> : null) : data.items.length === 0 ? (
        <div className="move-done">
          <p className="block-empty">规则都搬完了：说话方式在各自的 Soul 里，你的偏好在「关于你」里。</p>
          <button type="button" className="secondary-button" onClick={back}>回到记忆</button>
        </div>
      ) : <>
        <PickAll total={data.items.length} picked={chosen.length} disabled={busy} onAll={setAll} />
        {groups.map((group) => <MoveGroup key={group.key} data={data} groupKey={group.key} items={group.items}
          picks={picks} onPick={(id, pick) => setPicks((old) => new Map(old).set(id, pick))} />)}
        <PickBar picked={chosen.length}>
          <span className="text-meta">没勾的留在原处，下次整理再问</span>
          <button type="button" className="primary-button" disabled={busy || chosen.length === 0}
            onClick={() => void submit()}>搬过去 {chosen.length} 条</button>
        </PickBar>
      </>}
    </div>
  );
}
