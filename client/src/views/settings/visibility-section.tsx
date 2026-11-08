// 设置 · 对外可见（第 113 条，设计稿 Desktop-Visibility）：一张矩阵。上半是三类联系人能听到哪几档（台阶色块 + 人数），
// 下半按组（记忆 / 项目 / 笔记）每条材料一行四个单选；橙色空心圈 = Plasticine 的建议，等你确认。顶上「n 处等你确认」+
// 「全部确认」。点任何一档就是你定的（建议跟着清掉）。没标的一律私密；空的组不出现。

import { useEffect, type ReactNode } from 'react';
import {
  CONTACT_RELATION_LABELS,
  MATERIAL_KINDS,
  RELATION_REACH,
  TIER_LABELS,
  TIERS,
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
import { usePendingOps } from '../pending/pending-ops.tsx';
import { LoadNote } from '../m5b/load-note.tsx';

const GROUP_LABELS: Readonly<Record<MaterialKind, string>> = {
  memory_topic: '记忆',
  project: '项目',
  note: '笔记',
  space: '空间',
};

/** 这一格画成什么：选中的实心、建议的橙色空心圈、其余空圈。有建议时私密那一格不算「选中」（还没定过）。 */
function cellState(row: MaterialRow, tier: Tier): 'on' | 'ask' | 'off' {
  if (row.proposed === tier) {
    return 'ask';
  }
  const shown = row.proposed === null || row.tier !== 'private';
  return shown && row.tier === tier ? 'on' : 'off';
}

function cellLabel(row: MaterialRow, tier: Tier, state: 'on' | 'ask' | 'off'): string {
  const base = `${row.title}：${TIER_LABELS[tier]}`;
  if (state === 'ask') {
    return `${base}，Plasticine 建议，等你确认`;
  }
  return base;
}

function MaterialLine({ row }: { row: MaterialRow }): ReactNode {
  const { networkActions } = useLive();
  const ops = usePendingOps([visibilityOpKey(row.kind, row.id)], () => true);
  const busy = ops.some(isOpenOp);
  return (
    <div className="vis-row" role="radiogroup" aria-label={row.title}>
      <span className="vis-label">{row.title}</span>
      {TIERS.map((tier) => {
        const state = cellState(row, tier);
        return (
          <span key={tier} className="vis-cell">
            <button type="button" role="radio" className="vis-radio" data-state={state}
              aria-checked={state === 'on'} aria-label={cellLabel(row, tier, state)}
              title={state === 'ask' ? `Plasticine 建议「${TIER_LABELS[tier]}」` : TIER_LABELS[tier]}
              disabled={busy} onClick={() => void networkActions.mark(row, tier)} />
          </span>
        );
      })}
    </div>
  );
}

export function VisibilitySection(): ReactNode {
  const { network, networkActions } = useLive();
  const { actionOps } = useClientState();
  const matrix = useStore(network.visibility.data);
  const confirming = usePendingOps([VISIBILITY_CONFIRM_OP_KEY], () => true);
  // 在路上的不摆（点一下就回来了）；待核实、没送到、被拒的列在矩阵上面。
  const unsettled = usePendingOps(['visibility:'], () => true).filter((op) => op.status !== 'running')
    .map((op) => ({ ...op, label: `${op.label} · ${op.subject}` }));
  useEffect(() => {
    network.visibility.open();
  }, [network]);
  const value = matrix.value;
  return (
    <section className="block vis" aria-labelledby="settings-visibility">
      <header className="block-head vis-head">
        <h3 id="settings-visibility" className="block-title">对外可见</h3>
        {value !== null && value.pending > 0 ? (
          <>
            <span className="vis-pending"><span className="dot dot-accent" aria-hidden="true" />
              {value.pending} 处等你确认</span>
            <button type="button" className="chip-button vis-confirm" disabled={confirming.some(isOpenOp)}
              onClick={() => void networkActions.confirmAll()}>全部确认</button>
          </>
        ) : null}
      </header>
      <LoadNote resource={matrix} what="对外可见" onRetry={() => void network.visibility.reload()} />
      <OpLines ops={unsettled} onRetry={(key) => void networkActions.retry(key)}
        onDismiss={(key) => actionOps.dismiss(key)} />
      {value === null ? null : (
        <div className="vis-matrix">
          <div className="vis-row vis-cols" aria-hidden="true">
            <span />
            {TIERS.map((tier) => <span key={tier} className="vis-col">{TIER_LABELS[tier]}</span>)}
          </div>
          <p className="vis-group">谁能听到</p>
          {value.relations.map(({ relation, count }) => (
            <div key={relation} className="vis-row" role="group" aria-label={`${CONTACT_RELATION_LABELS[relation]}能听到：${
              RELATION_REACH[relation].map((tier) => TIER_LABELS[tier]).join('、')}`}>
              <span className="vis-label">{CONTACT_RELATION_LABELS[relation]}
                {count > 0 ? <span className="mono vis-count">{count}</span> : null}</span>
              {TIERS.map((tier) => (
                <span key={tier} className="vis-cell">
                  {RELATION_REACH[relation].includes(tier) ? <span className="vis-fill" /> : null}
                </span>
              ))}
            </div>
          ))}
          <span className="vis-rule" aria-hidden="true" />
          {MATERIAL_KINDS.map((kind) => {
            const rows = value.materials.filter((row) => row.kind === kind);
            if (rows.length === 0) {
              return null;
            }
            return (
              <div key={kind} className="vis-section" role="group" aria-label={GROUP_LABELS[kind]}>
                <p className="vis-group">{GROUP_LABELS[kind]}</p>
                {rows.map((row) => <MaterialLine key={`${row.kind}:${row.id}`} row={row} />)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
