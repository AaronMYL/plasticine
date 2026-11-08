// 任务栏目「定时」（设计稿 Tasks-Timed，手机 Phone-Tasks）：所有到点自己跑的事一行一个——做什么（图标块 · 名字 · 一句）、
// 下次、上次（状态符 + 一句，出错写原因）、开关、⋯（删、看它的线）。等他确认的卡开关拨不了，点这一行回到对话里那张卡。
// 点开一行出右侧弹层（timed-sheet.tsx）。

import { useState, type ReactNode } from 'react';
import type { TimedRowView } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { RevealMore, type RevealAction } from '../../shell/reveal-more.tsx';
import { mainLineRoute, type Route } from '../../shell/routes.ts';
import { nextText, timedIcon } from './task-format.ts';
import type { TaskActions } from './use-tasks-board.ts';

function Last({ row }: { row: TimedRowView }): ReactNode {
  if (row.last === null) {
    return null;
  }
  return <span className="tasks-last" data-glyph={row.last.glyph}><StatusGlyph status={row.last.glyph} />
    {row.last.text}</span>;
}

interface RowProps {
  row: TimedRowView;
  actions: TaskActions;
  open: (row: TimedRowView) => void;
  navigate: (route: Route) => void;
}

function DeskRow({ row, actions, open, navigate }: RowProps): ReactNode {
  const timeZone = useTimeZone();
  const openPanel = useOpenPanel();
  const [removing, setRemoving] = useState(false);
  const more: RevealAction[] = [];
  if (row.lineId !== null) {
    more.push({ icon: 'thread', label: '看它的线', onSelect: () => openPanel({ kind: 'work', lineId: row.lineId! }) });
  }
  if (row.canRemove) {
    more.push({ icon: 'trash', label: '删掉', onSelect: () => setRemoving(true) });
  }
  const click = (): void => (row.askId !== null ? navigate(mainLineRoute()) : open(row));
  return (
    <li className="tasks-timed-item">
      <div className="tasks-row tasks-timed-row">
        <button type="button" className="tasks-row-main tasks-timed-what" aria-label={`打开：${row.title}`}
          onClick={click}>
          <HueTile hue={row.hue} icon={timedIcon(row.icon)} />
          <span className="tasks-timed-text">
            <span className="tasks-row-title">{row.title}</span>
            <span className="tasks-row-meta">{row.summary}</span>
          </span>
        </button>
        <span className="tasks-timed-next">
          {row.nextAt === null ? '' : nextText(row.nextAt, new Date(), timeZone)}
        </span>
        <span className="tasks-timed-last"><Last row={row} /></span>
        <span className="tasks-timed-tail">
          <input type="checkbox" role="switch" aria-label={`${row.title}：开着`} checked={row.enabled}
            disabled={!row.canToggle || actions.busy === row.id}
            data-tip={row.canToggle ? undefined : '在对话里的卡上确认才生效'}
            onChange={(event) => void actions.setEnabled(row.id, event.target.checked)} />
          <RevealMore label={`「${row.title}」的更多操作`} actions={more} />
        </span>
      </div>
      {removing ? (
        <div className="tasks-confirm" role="group" aria-label={`删掉「${row.title}」`}>
          <span>删掉后不再到点，已经做过的结果还在。</span>
          <button type="button" className="primary-button button-small" disabled={actions.busy === row.id}
            onClick={() => void actions.remove(row.id).then(() => setRemoving(false))}>删掉</button>
          <button type="button" className="text-button text-button-quiet" onClick={() => setRemoving(false)}>算了</button>
        </div>
      ) : null}
      {actions.failed?.id === row.id ? <p className="tasks-error" role="alert">{actions.failed.text}</p> : null}
    </li>
  );
}

/** 手机（Phone-Tasks）：图标块 · 名字 · 「下次 15:00 · 上次没事」· 等你的点 · ›，点开是底部抽屉。 */
function PhoneRow({ row, open, navigate }: RowProps): ReactNode {
  const timeZone = useTimeZone();
  const meta = row.askId !== null ? `${row.summary.split(' · ')[0]} · ${row.last?.text ?? ''}`
    : [row.nextAt === null ? null : `下次 ${nextText(row.nextAt, new Date(), timeZone)}`,
      row.last === null ? null : `上次${/^[A-Za-z0-9]/.test(row.last.text) ? ' ' : ''}${row.last.text}`].filter((part) => part !== null).join(' · ');
  return (
    <li>
      <button type="button" className="tasks-row tasks-phone-row" aria-label={`打开：${row.title}`}
        onClick={() => (row.askId !== null ? navigate(mainLineRoute()) : open(row))}>
        <HueTile hue={row.hue} icon={timedIcon(row.icon)} />
        <span className="tasks-timed-text">
          <span className="tasks-row-title">{row.title}</span>
          <span className="tasks-row-meta">{meta === '' ? row.summary : meta}</span>
        </span>
        {row.last?.glyph === 'wait' ? <StatusGlyph status="wait" /> : null}
        <Icon name="chevron-right" size={14} />
      </button>
    </li>
  );
}

export interface TasksTimedProps {
  rows: TimedRowView[];
  actions: TaskActions;
  phone: boolean;
  open: (row: TimedRowView) => void;
  navigate: (route: Route) => void;
}

export function TasksTimed({ rows, actions, phone, open, navigate }: TasksTimedProps): ReactNode {
  if (rows.length === 0) {
    return <p className="tasks-empty">还没有定时的事。跟 Plasticine 说「每周一早上帮我……」就能加。</p>;
  }
  if (phone) {
    return <ul className="tasks-rows">{rows.map((row) => <PhoneRow key={row.id} row={row} actions={actions}
      open={open} navigate={navigate} />)}</ul>;
  }
  return (
    <div className="tasks-timed">
      <div className="tasks-timed-head" aria-hidden="true">
        <span>做什么</span><span>下次</span><span>上次</span><span />
      </div>
      <ul className="tasks-rows" aria-label="定时">
        {rows.map((row) => <DeskRow key={row.id} row={row} actions={actions} open={open} navigate={navigate} />)}
      </ul>
    </div>
  );
}
