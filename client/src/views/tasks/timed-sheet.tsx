// 定时列表点开一行、队友点开一位：右侧弹层（原语 7 的 panel，手机是底部抽屉）。弹层里画什么按来源登记——心跳那样的
// 设置（设计稿 Tasks-Heartbeat）由后面的线经 registerTimedSheet 放进来；没登记的来源用这里的默认：做什么、下次、上次、
// 开关、删（带后果）、看它的线。队友的弹层写它管哪几行、在做什么，能叫停（停掉它管的每一行，正在做的这一轮也停）。

import { useState, type ComponentType, type ReactNode } from 'react';
import type { TeammateView, TimedRowView, TimedSource } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { nextText } from './task-format.ts';
import type { TaskActions } from './use-tasks-board.ts';

export interface TimedSheetProps {
  row: TimedRowView;
  actions: TaskActions;
  close: () => void;
}

const SHEETS = new Map<TimedSource, ComponentType<TimedSheetProps>>();

/** 别的线（心跳、做梦、订阅）把自己那一行点开后的弹层内容登记进来；没登记的用默认。 */
export function registerTimedSheet(source: TimedSource, component: ComponentType<TimedSheetProps>): void {
  SHEETS.set(source, component);
}

export type OpenSheet = { kind: 'row'; row: TimedRowView } | { kind: 'mate'; mate: TeammateView; rows: TimedRowView[] };

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return <div className="tasks-field"><span className="tasks-field-label">{label}</span><div>{children}</div></div>;
}

function DefaultTimed({ row, actions, close }: TimedSheetProps): ReactNode {
  const timeZone = useTimeZone();
  const openPanel = useOpenPanel();
  const [removing, setRemoving] = useState(false);
  const busy = actions.busy === row.id;
  return (
    <div className="tasks-sheet-body">
      <Field label="做什么">{row.summary}</Field>
      <Field label="下次">{row.nextAt === null ? '—' : nextText(row.nextAt, new Date(), timeZone)}</Field>
      <Field label="上次">
        {row.last === null ? '—' : <span className="tasks-last" data-glyph={row.last.glyph}>
          <StatusGlyph status={row.last.glyph} />{row.last.text}</span>}
      </Field>
      {row.lineId === null ? null : (
        <Field label="它的线">
          <button type="button" className="text-button" onClick={() => openPanel({ kind: 'work',
            lineId: row.lineId! })}>看这条线做了什么</button>
        </Field>
      )}
      {!row.canRemove ? null : removing ? (
        <div className="tasks-confirm" role="group" aria-label="删掉这个定时任务">
          <span>删掉后不再到点，已经做过的结果还在。</span>
          <button type="button" className="primary-button button-small" disabled={busy}
            onClick={() => void actions.remove(row.id).then(close)}>删掉</button>
          <button type="button" className="text-button text-button-quiet" onClick={() => setRemoving(false)}>算了</button>
        </div>
      ) : (
        <button type="button" className="secondary-button button-small tasks-remove"
          onClick={() => setRemoving(true)}>删掉</button>
      )}
      {actions.failed?.id === row.id ? <p className="tasks-error" role="alert">{actions.failed.text}</p> : null}
    </div>
  );
}

function MateBody({ mate, rows, actions }: { mate: TeammateView; rows: TimedRowView[]; actions: TaskActions })
  : ReactNode {
  const busy = actions.busy === mate.id;
  return (
    <div className="tasks-sheet-body">
      <Field label="在做">{mate.now === '' ? '—' : mate.now}</Field>
      <Field label="管着">
        <ul className="tasks-sheet-list">
          {rows.map((row) => <li key={row.id}>{row.title}<span className="tasks-row-meta">{row.summary}</span></li>)}
        </ul>
      </Field>
      {mate.canStop ? (
        <div className="tasks-confirm">
          <span>叫停后它管的定时都停下，正在做的这一轮也停；要再开在定时里拨开关。</span>
          <button type="button" className="primary-button button-small" disabled={busy}
            onClick={() => void actions.stopTeammate(mate.id)}>叫停</button>
        </div>
      ) : null}
      {actions.failed?.id === mate.id ? <p className="tasks-error" role="alert">{actions.failed.text}</p> : null}
    </div>
  );
}

export function TimedSheet({ open, actions, phone, close }: { open: OpenSheet | null; actions: TaskActions;
  phone: boolean; close: () => void }): ReactNode {
  const row = open?.kind === 'row' ? open.row : null;
  const mate = open?.kind === 'mate' ? open.mate : null;
  const title = row?.title ?? mate?.name ?? '';
  const Body = row === null ? null : SHEETS.get(row.source) ?? DefaultTimed;
  const toggle = row !== null && row.canToggle ? (
    <input type="checkbox" role="switch" aria-label={`${row.title}：开着`} checked={row.enabled}
      disabled={actions.busy === row.id} onChange={(event) => void actions.setEnabled(row.id, event.target.checked)} />
  ) : null;
  return (
    <Sheet open={open !== null} variant={phone ? 'drawer' : 'panel'} title={title} onClose={close}
      className="tasks-sheet" actions={toggle}>
      {row !== null && Body !== null ? <Body row={row} actions={actions} close={close} /> : null}
      {mate !== null && open?.kind === 'mate' ? <MateBody mate={mate} rows={open.rows} actions={actions} /> : null}
    </Sheet>
  );
}
