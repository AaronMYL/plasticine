// 首页「现在」的前两块（2026-11-05 设计稿 Home）：
//   等你 n  全站唯一列出等你的地方：一行一件，图标块 · 一句 ·「去看」· ⋯（先不）。「去看」在这一行下面就地摊开那张卡
//           （后台线出的卡不在主对话里，就地答最直接）；
//   在做    在跑的后台线：动态符号 · 标题 · 实时状态 · 已用时间 · 停止；暂停 / 出错的线也在这里，各写一句。
//           停在要你定卡上的线不在这里（那张卡在「等你」里，一件事只列一处）。

import { useState, type ReactNode } from 'react';
import type { LineView } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { AskTag } from '../../primitives/ask-card/index.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { useStore } from '../../state/use-store.ts';
import { LineAskCard } from '../asks/line-ask-card.tsx';
import { lineElapsed, useNow } from '../lines/line-time.ts';
import { WorkLineAction, WorkStatusGlyph, workStatusText } from '../lines/work-status.tsx';
import './home.css';

function WaitRow({ ask, phone }: { ask: AskView; phone: boolean }): ReactNode {
  const live = useLive();
  const openPanel = useOpenPanel();
  const [open, setOpen] = useState(false);
  const work = ask.networkTaskId !== undefined ? { kind: 'work' as const, taskId: ask.networkTaskId }
    : ask.lineId !== null && live.lines.lineOf(ask.lineId)?.kind === 'background'
      ? { kind: 'work' as const, lineId: ask.lineId } : null;
  return (
    <li className="home-wait">
      <div className="home-row-line home-wait-row">
        <AskTag ask={ask} />
        <span className="home-wait-title">{ask.question}</span>
        <button type="button" className={`${open ? 'secondary-button' : 'primary-button'} button-small`}
          aria-expanded={work === null ? open : undefined}
          onClick={() => work === null ? setOpen((value) => !value) : openPanel(work)}>{open ? '收起' : '去看'}</button>
        <RevealMore label={`「${ask.question}」的更多操作`}
          actions={[{ icon: 'clock', label: '先不', onSelect: () => void live.asks.defer(ask) }]} />
      </div>
      {open ? <div className="home-wait-card" data-phone={phone}><LineAskCard ask={ask} /></div> : null}
    </li>
  );
}

export function HomeWaiting({ phone }: { phone: boolean }): ReactNode {
  const live = useLive();
  const data = useStore(live.asks.store);
  if (data.open.length === 0) {
    return null;
  }
  return (
    <section className="home-section" aria-label="等你">
      <h2 className="home-section-title">等你<span className="home-section-count">{data.open.length}</span></h2>
      <ul className="home-list">
        {data.open.map((ask) => <WaitRow key={ask.id} ask={ask} phone={phone} />)}
      </ul>
    </section>
  );
}

/** 在做那一栏放哪些线：后台线里没做完、也不在等你的（在跑、暂停、出错），在跑的在前。 */
export function doingLines(lines: readonly LineView[]): LineView[] {
  const rank: Readonly<Record<LineView['status'], number>> = {
    running: 0, queued: 1, waiting: 2, paused: 3, failed: 4, idle: 5,
  };
  // 旁聊（第 17 条）和主线一样是对话，不是活：不进「在做」。
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
  const list = useStore(live.lines.list);
  const doing = doingLines(list.lines);
  const now = useNow(doing.some((line) => line.status === 'running'));
  if (doing.length === 0) {
    return null;
  }
  return (
    <section className="home-section" aria-label="在做">
      <h2 className="home-section-title">在做</h2>
      <ul className="home-list">
        {doing.map((line) => <DoingRow key={line.id} line={line} phone={phone} now={now} />)}
      </ul>
    </section>
  );
}
