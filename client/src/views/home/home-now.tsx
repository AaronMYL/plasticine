import { useState, type ReactNode } from 'react';
import type { LineView } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { AskTag } from '../../primitives/ask-card/index.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { messagesRoute, routeHash } from '../../shell/routes.ts';
import { useTabActions } from '../../shell/tabs-context.ts';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { useStore } from '../../state/use-store.ts';
import { LineAskCard } from '../asks/line-ask-card.tsx';
import { ConnectSheet, useNoModel } from '../models/connect-sheet.tsx';
import { lineElapsed, useNow } from '../lines/line-time.ts';
import { WorkLineAction, WorkStatusGlyph, workStatusText } from '../lines/work-status.tsx';
import { AskPlaceProvider } from '../asks/ask-context.tsx';
import { useAskOrigin } from '../asks/ask-labels.ts';
import './home.css';

const WAIT_PLACE = { kind: 'wait' } as const;

function WaitRow({ ask, phone }: { ask: AskView; phone: boolean }): ReactNode {
  const live = useLive();
  const openPanel = useOpenPanel();
  const [open, setOpen] = useState(false);
  const work = ask.networkTaskId !== undefined ? { kind: 'work' as const, taskId: ask.networkTaskId }
    : ask.lineId !== null && live.lines.lineOf(ask.lineId)?.kind === 'background'
      ? { kind: 'work' as const, lineId: ask.lineId } : null;
  const chat = ask.networkReply === undefined ? null : ask.networkReply.groupId ?? ask.networkReply.contactId;
  const origin = useAskOrigin()(ask);
  return (
    <li className="home-wait">
      <div className="home-row-line home-wait-row">
        <AskTag ask={ask} />
        <span className="home-wait-text">
          <span className="home-wait-title">{ask.question}</span>
          {origin === null ? null : <span className="home-wait-from">{origin}</span>}
        </span>
        {chat !== null ? <a className="primary-button button-small" href={routeHash(messagesRoute(chat))}>去回</a>
          : <button type="button" className={`${open ? 'secondary-button' : 'primary-button'} button-small`}
          aria-expanded={work === null ? open : undefined}
          onClick={() => work === null ? setOpen((value) => !value) : openPanel(work)}>{open ? '收起' : '去看'}</button>}
        <RevealMore label={`「${ask.question}」的更多操作`}
          actions={[{ icon: 'clock', label: '先不', onSelect: () => void live.asks.defer(ask) }]} />
      </div>
      {open ? <div className="home-wait-card" data-phone={phone}>
        <AskPlaceProvider place={WAIT_PLACE}><LineAskCard ask={ask} /></AskPlaceProvider>
      </div> : null}
    </li>
  );
}

function NoModelRow(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <li className="home-wait">
      <div className="home-row-line home-wait-row">
        <span className="ask-glyph" data-urgent="true" aria-hidden="true"><Icon name="clock" size={14} /></span>
        <span className="home-wait-title">连上模型后，定时的事才会跑</span>
        <button type="button" className="primary-button button-small" onClick={() => setOpen(true)}>去连</button>
      </div>
      <ConnectSheet open={open} pendingText="" onConnected={() => setOpen(false)} onClose={() => setOpen(false)} />
    </li>
  );
}

export function HomeWaiting({ phone }: { phone: boolean }): ReactNode {
  const live = useLive();
  const data = useStore(live.asks.store);
  const noModel = useNoModel();
  const count = data.open.length + (noModel ? 1 : 0);
  if (count === 0) {
    return null;
  }
  return (
    <section className="home-section" aria-label="等你">
      <h2 className="home-section-title">等你<span className="home-section-count">{count}</span></h2>
      <ul className="home-list">
        {noModel ? <NoModelRow /> : null}
        {data.open.map((ask) => <WaitRow key={ask.id} ask={ask} phone={phone} />)}
      </ul>
    </section>
  );
}

export function doingLines(lines: readonly LineView[]): LineView[] {
  const rank: Readonly<Record<LineView['status'], number>> = {
    running: 0, queued: 1, waiting: 2, paused: 3, failed: 4, idle: 5,
  };
  return lines.filter((line) => line.kind === 'background' && line.status !== 'idle' && line.status !== 'waiting')
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.activeSince ?? a.createdAt)
      .localeCompare(b.activeSince ?? b.createdAt));
}

export function DoingRow({ line, phone, now }: { line: LineView; phone: boolean; now: number }): ReactNode {
  const openPanel = useOpenPanel();
  const timeZone = useTimeZone();
  const [error, setError] = useState<string | null>(null);
  const status = workStatusText(line, timeZone);
  const elapsed = line.status === 'running' ? lineElapsed(line, now) : null;
  return (
    <li className="home-row-line home-doing-row" data-status={line.status} data-phone={phone}>
      <button type="button" className="home-work-open" aria-label={`查看工作：${line.title}`}
        onClick={() => openPanel({ kind: 'work', lineId: line.id })}>
      <span className="home-doing-lead"><WorkStatusGlyph line={line} /></span>
      <span className="home-doing-text">
        <span className="home-doing-title">{line.title}</span>
        <span className="home-doing-status" data-status={line.status}>
          {error ?? status}
          {phone && elapsed !== null ? <span className="home-doing-elapsed"> · {elapsed}</span> : null}
        </span>
      </span>
      {!phone && elapsed !== null ? <span className="line-elapsed">{elapsed}</span> : null}
      </button>
      <WorkLineAction line={line} onError={setError} />
    </li>
  );
}

export function HomeDoing({ phone }: { phone: boolean }): ReactNode {
  const live = useLive();
  const tabs = useTabActions();
  const list = useStore(live.lines.list);
  const doing = doingLines(list.lines);
  const now = useNow(doing.some((line) => line.status === 'running'));
  if (doing.length === 0) {
    return null;
  }
  return (
    <section className="home-section" aria-label="在做">
      <h2 className="home-section-title">在做<span className="home-section-count">{doing.length}</span>
        <button type="button" className="text-button home-section-more"
          onClick={() => tabs.focusSection('tasks')}>全部任务</button></h2>
      <ul className="home-list">
        {doing.map((line) => <DoingRow key={line.id} line={line} phone={phone} now={now} />)}
      </ul>
    </section>
  );
}
