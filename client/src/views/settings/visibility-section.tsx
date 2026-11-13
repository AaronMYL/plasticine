// 设置 · 隐私与授权 ·「对外可见」（第 113 条；11-13 重做，Aaron 弹框选「还是四档，只列放开的」）：默认都私密，
// 朋友、合作、公开三栏里只列放开的，每样一个小片（哪一类 + 名字 + ×，× 就是收回成私密）；每栏一个「添加」，点开找要放开的。
// Plasticine 的建议是虚线框的小片（√ 同意、× 不要），顶上一行能一次都同意或都不要。最下面一行写其余多少样是私密。
// 原来是一张矩阵（每样材料一行四个单选），他线上 332 行里 326 行是私密，太长。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MATERIAL_KINDS,
  TIER_LABELS,
  type ContactRelation,
  type MaterialKind,
  type MaterialRow,
  type Tier,
} from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { VISIBILITY_CONFIRM_OP_KEY, visibilityOpKey } from '../../state/contacts-action-requests.ts';
import { useStore } from '../../state/use-store.ts';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { Icon } from '../../shell/icons.tsx';
import { Popover, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { usePendingOps } from '../pending/pending-ops.tsx';
import { LoadNote } from '../m5b/load-note.tsx';
import { SectionHead } from './section-head.tsx';

const KIND_LABELS: Readonly<Record<MaterialKind, string>> = {
  memory_topic: '记忆',
  project: '项目',
  note: '笔记',
  space: '空间',
};

/** 放开的三档，从只给朋友到给所有人。 */
export const SHARED_TIERS = ['friend', 'partner', 'public'] as const satisfies readonly Tier[];
type SharedTier = (typeof SHARED_TIERS)[number];

const VISIBILITY_TIP = '别人 @ 你的 Plasticine 时，它只用这里放开的资料回答，没放开的一律不说。'
  + '\n朋友能问到「朋友」「合作」「公开」三栏；合作方能问到「合作」「公开」；陌生人只能问到「公开」。';

/** 「添加」里不搜时先列这么多，搜了最多这么多。 */
const PICKER_SHOWN = 8;

type Counts = Readonly<Record<ContactRelation, number>>;

/** 这一栏谁能问到（带上现在有几位）。 */
export function tierAudience(tier: SharedTier, counts: Counts): string {
  if (tier === 'friend') {
    return counts.friend > 0 ? `${counts.friend} 位朋友能问到` : '朋友能问到';
  }
  if (tier === 'partner') {
    return counts.partner > 0 ? `${counts.partner} 位合作方和朋友能问到` : '合作方和朋友能问到';
  }
  return '所有人能问到';
}

/** 你定过放在这一栏的（建议还没确认的不算）。 */
export function sharedIn(rows: readonly MaterialRow[], tier: SharedTier): MaterialRow[] {
  return rows.filter((row) => row.tier === tier);
}

/** Plasticine 建议放进这一栏、等你确认的。 */
export function proposedIn(rows: readonly MaterialRow[], tier: SharedTier): MaterialRow[] {
  return rows.filter((row) => row.proposed === tier && row.tier !== tier);
}

/** 「添加」里能挑的：还是私密、也没有建议放进这一栏的；按打的字找名字。 */
export function addable(rows: readonly MaterialRow[], tier: SharedTier, query: string): MaterialRow[] {
  const term = query.trim().toLocaleLowerCase();
  return rows.filter((row) => row.tier === 'private' && row.proposed !== tier
    && (term === '' || row.title.toLocaleLowerCase().includes(term)));
}

/** 「其余 326 样都是私密：记忆 11 · 项目 2 · 笔记 252 · 空间 61」。一样私密的都没有就是 null。 */
export function privateSummary(rows: readonly MaterialRow[]): string | null {
  const hidden = rows.filter((row) => row.tier === 'private' && row.proposed === null);
  if (hidden.length === 0) {
    return null;
  }
  const parts = MATERIAL_KINDS.map((kind) => [kind, hidden.filter((row) => row.kind === kind).length] as const)
    .filter(([, count]) => count > 0).map(([kind, count]) => `${KIND_LABELS[kind]} ${count}`);
  return `其余 ${hidden.length} 样都是私密：${parts.join(' · ')}`;
}

function rowTitle(row: MaterialRow): string {
  return row.title.trim() === '' ? '未命名' : row.title;
}

function Chip({ row, tier, pending }: { row: MaterialRow; tier: SharedTier; pending: boolean }): ReactNode {
  const { networkActions } = useLive();
  const busy = usePendingOps([visibilityOpKey(row.kind, row.id)], () => true).some(isOpenOp);
  const title = rowTitle(row);
  return (
    <li className="vis-chip" data-pending={pending ? 'true' : undefined}>
      <span className="vis-chip-kind">{KIND_LABELS[row.kind]}</span>
      <span className="vis-chip-title" title={title}>{title}</span>
      {pending ? (
        <button type="button" className="vis-chip-action" disabled={busy}
          aria-label={`同意把「${title}」放到${TIER_LABELS[tier]}`} onClick={() => void networkActions.mark(row, tier)}>
          <Icon name="check" size={14} />
        </button>
      ) : null}
      <button type="button" className="vis-chip-action" disabled={busy}
        aria-label={pending ? `不要这条建议：${title}` : `收回「${title}」，改回私密`}
        onClick={() => void networkActions.mark(row, pending ? row.tier : 'private')}>
        <Icon name="close" size={13} />
      </button>
    </li>
  );
}

function AddButton({ rows, tier }: { rows: readonly MaterialRow[]; tier: SharedTier }): ReactNode {
  const { networkActions } = useLive();
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const [query, setQuery] = useState('');
  const found = useMemo(() => addable(rows, tier, query), [rows, tier, query]);
  const close = (): void => {
    setAnchor(null);
    setQuery('');
  };
  return (
    <li className="vis-add-slot">
      <button ref={button} type="button" className="vis-add" aria-haspopup="dialog" aria-expanded={anchor !== null}
        aria-label={`添加到${TIER_LABELS[tier]}`}
        onClick={() => (anchor === null && button.current !== null ? setAnchor(anchorOf(button.current)) : close())}>
        <Icon name="plus" size={14} />添加
      </button>
      {anchor === null ? null : (
        <Popover anchor={anchor} label={`放到${TIER_LABELS[tier]}`} role="dialog" trigger={button} className="vis-picker"
          onClose={close}>
          <label className="vis-picker-search">
            <Icon name="search" size={14} />
            <input type="search" className="search-input" aria-label="找记忆、项目、笔记、空间"
              placeholder="找记忆、项目、笔记、空间" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {found.length === 0 ? <p className="vis-picker-empty">{query.trim() === '' ? '没有还能放开的了' : '没有找到'}</p>
            : (
              <ul className="vis-picker-list" aria-label="能放开的">
                {found.slice(0, PICKER_SHOWN).map((row) => (
                  <li key={`${row.kind}:${row.id}`}>
                    <button type="button" className="vis-picker-row" onClick={() => {
                      close();
                      void networkActions.mark(row, tier);
                    }}>
                      <span className="vis-chip-kind">{KIND_LABELS[row.kind]}</span>
                      <span className="vis-picker-title">{rowTitle(row)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          {found.length > PICKER_SHOWN ? <p className="vis-picker-empty">还有 {found.length - PICKER_SHOWN} 样，接着打字找</p>
            : null}
        </Popover>
      )}
    </li>
  );
}

function TierBlock({ rows, tier, counts }: { rows: readonly MaterialRow[]; tier: SharedTier; counts: Counts })
  : ReactNode {
  const shared = sharedIn(rows, tier);
  const proposed = proposedIn(rows, tier);
  return (
    <section className="vis-tier" aria-label={`${TIER_LABELS[tier]}：${tierAudience(tier, counts)}`}>
      <header className="vis-tier-head">
        <h4 className="vis-tier-title">{TIER_LABELS[tier]}</h4>
        <span className="vis-tier-who">{tierAudience(tier, counts)}</span>
      </header>
      <ul className="vis-chips">
        {shared.map((row) => <Chip key={`${row.kind}:${row.id}`} row={row} tier={tier} pending={false} />)}
        {proposed.map((row) => <Chip key={`ask:${row.kind}:${row.id}`} row={row} tier={tier} pending />)}
        {shared.length + proposed.length === 0 ? <li className="vis-none">还没有放开的</li> : null}
        <AddButton rows={rows} tier={tier} />
      </ul>
    </section>
  );
}

export function VisibilitySection(): ReactNode {
  const { network, networkActions } = useLive();
  const { actionOps } = useClientState();
  const matrix = useStore(network.visibility.data);
  const confirming = usePendingOps([VISIBILITY_CONFIRM_OP_KEY], () => true);
  // 在路上的不摆（点一下就回来了）；待核实、没送到、被拒的列在上面。
  const unsettled = usePendingOps(['visibility:'], () => true).filter((op) => op.status !== 'running')
    .map((op) => ({ ...op, label: `${op.label} · ${op.subject}` }));
  const [declining, setDeclining] = useState(false);
  useEffect(() => {
    network.visibility.open();
  }, [network]);
  const value = matrix.value;
  const rows = value?.materials ?? [];
  const counts: Counts = { stranger: 0, partner: 0, friend: 0,
    ...Object.fromEntries((value?.relations ?? []).map((entry) => [entry.relation, entry.count])) };
  const summary = privateSummary(rows);
  const declineAll = async (): Promise<void> => {
    setDeclining(true);
    try {
      for (const row of rows.filter((entry) => entry.proposed !== null)) {
        await networkActions.mark(row, row.tier);
      }
    } finally {
      setDeclining(false);
    }
  };
  return (
    <section className="block vis" aria-labelledby="settings-visibility">
      <SectionHead id="settings-visibility" title="对外可见" tip={VISIBILITY_TIP} />
      <LoadNote resource={matrix} what="对外可见" onRetry={() => void network.visibility.reload()} />
      <OpLines ops={unsettled} onRetry={(key) => void networkActions.retry(key)}
        onDismiss={(key) => actionOps.dismiss(key)} />
      {value === null ? null : (
        <>
          {value.pending === 0 ? null : (
            <div className="vis-suggest" role="group" aria-label="Plasticine 的建议">
              <span className="vis-suggest-tag"><Icon name="clock" size={13} />等你</span>
              <span className="vis-suggest-text">Plasticine 建议再放开 {value.pending} 样（虚线框的）</span>
              <button type="button" className="primary-button button-small"
                disabled={declining || confirming.some(isOpenOp)} onClick={() => void networkActions.confirmAll()}>
                都同意</button>
              <button type="button" className="secondary-button button-small"
                disabled={declining || confirming.some(isOpenOp)} onClick={() => void declineAll()}>都不要</button>
            </div>
          )}
          {SHARED_TIERS.map((tier) => <TierBlock key={tier} rows={rows} tier={tier} counts={counts} />)}
          {summary === null ? null : <p className="vis-rest"><Icon name="lock" size={14} />{summary}</p>}
        </>
      )}
    </section>
  );
}
