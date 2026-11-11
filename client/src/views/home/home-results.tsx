// 首页「新的」（11-11 第 11 批）：最近交付的工作、最近一期回顾、昨晚整理的记忆。刷新失败保留已有结果，加载中不把空白
// 伪装成「什么都没有」。

import { useState, type ReactNode } from 'react';
import type { LineView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { relativeTime } from '../../shell/relative-time.ts';
import { useStore } from '../../state/use-store.ts';
import { unmetReason, unmetText } from '../lines/work-status.tsx';
import { ReviewRows, useHomeReview } from './home-review.tsx';

export function recentResults(lines: readonly LineView[]): LineView[] {
  return lines.filter((line) => line.kind === 'background' && line.status === 'idle'
    && line.outcome === 'done' && line.queued === 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 一行结果：做成打勾；跑完了但没做成是叉，标题后面一句红字原因（设计稿 Tasks-Run「刚做完」）。 */
function ResultRow({ line, now, onOpen }: { line: LineView; now: Date; onOpen: () => void }): ReactNode {
  const unmet = unmetReason(line);
  return (
    <button type="button" className="home-row-line home-result-row" onClick={onOpen}>
      {unmet === null ? <StatusGlyph status="done" label="已完成" /> : <StatusGlyph status="err" label="没做成" />}
      <span className="home-result-title">{line.title}
        {unmet === null ? null : <span className="home-result-unmet">{unmetText(unmet)}</span>}</span>
      <span className="home-result-time">{relativeTime(line.updatedAt, now)}</span>
      <Icon name="chevron-right" size={14} />
    </button>
  );
}

export function HomeNew({ now }: { now: Date }): ReactNode {
  const live = useLive();
  const open = useOpenPanel();
  const data = useStore(live.lines.list);
  const [all, setAll] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const review = useHomeReview();
  const results = recentResults(data.lines);
  if (data.loaded && data.error === null && results.length === 0 && review === null) return null;
  const reviewCount = review === null ? 0 : (review.latest === null ? 0 : 1) + (review.dream === null ? 0 : 1);
  const retry = (): void => {
    setRetrying(true);
    void live.lines.loadList().finally(() => setRetrying(false));
  };
  return (
    <section className="home-section" aria-label="新的" aria-busy={!data.loaded || retrying}>
      <h2 className="home-section-title">新的
        <span className="home-section-count">{results.length + reviewCount}</span>
        {results.length > 4 ? <button type="button" className="text-button home-results-all"
          onClick={() => setAll((value) => !value)}>{all ? '收起' : '全部'}</button> : null}
      </h2>
      {!data.loaded ? <div className="home-results-loading" role="status" aria-label="正在读新的">
        <span /><span />
      </div> : null}
      {data.error === null ? null : <div className="home-results-error" role="alert">
        <span>{results.length > 0 ? '刷新失败，保留上次结果' : '暂时读不到工作结果'}</span>
        <button type="button" className="text-button" disabled={retrying} onClick={retry}>重试</button>
      </div>}
      <ul className="home-list">
        {(all ? results : results.slice(0, 4)).map((line) => <li key={line.id}>
          <ResultRow line={line} now={now} onOpen={() => open({ kind: 'work', lineId: line.id })} />
        </li>)}
        {review === null ? null : <ReviewRows value={review} />}
      </ul>
    </section>
  );
}
