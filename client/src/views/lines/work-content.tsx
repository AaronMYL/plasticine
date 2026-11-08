// 详情的正文：核验过的来源、完整成果与旧版本、按需展开的真实执行过程。

import { useMemo, useState, type ReactNode } from 'react';
import type { LineDetailsResponse, LineResultView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { formatClock } from '../../primitives/message/states.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import { FoldRow, StepList } from './line-parts.tsx';
import type { LineThreadData } from './line-thread-data.ts';
import { buildTimeline } from './timeline.ts';

export function WorkRequest({ request }: { request: LineDetailsResponse['request'] }): ReactNode {
  const [showSource, setShowSource] = useState(false);
  if (request === null) return null;
  const source = request.source;
  return <section className="work-section">
    <div className="work-section-head">
      <h3>{source !== null && source.text === request.text ? '原请求' : '任务要求'}</h3>
      {source === null ? null : <button type="button" className="text-button" aria-expanded={showSource}
        onClick={() => setShowSource((value) => !value)}>{showSource ? '收起原话' : '查看原话'}
        <Icon name="chevron-right" size={12} /></button>}
    </div>
    <p className="work-request">{request.text}</p>
    {showSource && source !== null ? <blockquote className="work-source" aria-label="用户原话">
      {source.text}
    </blockquote> : null}
  </section>;
}

export function WorkResults({ results, current, hasMore, loading, onEarlier }:
  { results: readonly LineResultView[]; current: boolean; hasMore: boolean; loading: boolean;
    onEarlier: () => void }): ReactNode {
  const [history, setHistory] = useState(false);
  const timeZone = useTimeZone();
  const latest = results[0];
  if (latest === undefined) return null;
  return <section className="work-section work-results" aria-label="工作成果">
    <div className="work-section-head"><h3><AiMark />{current ? '成果' : '已保留的结果'}</h3>
      {results.length > 1 || hasMore ? <button type="button" className="text-button" aria-expanded={history}
        onClick={() => setHistory((value) => !value)}>历史版本<Icon name="chevron-right" size={12} /></button> : null}
    </div>
    <Markdown text={latest.text} />
    {history ? <div className="work-history" aria-label="历史版本">
      {results.slice(1).map((result) => <details key={result.seq}>
        <summary><Icon name="history" size={14} />
          <span>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone })
            .format(new Date(result.createdAt))} · {formatClock(result.createdAt, false, timeZone)}</span>
          <span>{result.complete ? '已写完' : '未写完'}</span>
        </summary>
        <Markdown text={result.text} />
      </details>)}
      {hasMore ? <button type="button" className="text-button" disabled={loading} onClick={onEarlier}>
        {loading ? '正在读…' : '更早的版本'}</button> : null}
    </div> : null}
  </section>;
}

export function WorkProcess({ lineId, thread }: { lineId: string; thread: LineThreadData }): ReactNode {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const steps = useMemo(() => buildTimeline({ lineId, messages: thread.messages, lines: [],
    summaries: thread.summaries }).flatMap((item) => item.kind === 'turn' ? item.steps : []),
  [lineId, thread.messages, thread.summaries]);
  return <section className="work-process">
    <FoldRow label="查看过程" open={open} onToggle={() => setOpen((value) => !value)} />
    {open ? <div className="work-process-body">
      {thread.hasMore ? <button type="button" className="text-button" disabled={thread.loadingEarlier}
        onClick={() => void live.lines.loadEarlier(lineId)}>{thread.loadingEarlier ? '正在读…' : '更早的过程'}</button> : null}
      <StepList steps={steps} />
      {thread.messages.filter((message) => message.role === 'user').map((message) =>
        <p className="work-process-input" key={message.seq}>{message.text}</p>)}
      {thread.error === null ? null : <p className="work-error" role="alert">{thread.error}</p>}
    </div> : null}
  </section>;
}
