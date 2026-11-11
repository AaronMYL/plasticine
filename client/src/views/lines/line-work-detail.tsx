// 同一件工作的持续页面；任务正文和旧成果留在原位，状态变化不会重建输入框。

import { useState, type ReactNode } from 'react';
import type { NetworkTaskView } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { AiMark, StatusGlyph } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import type { Route } from '../../shell/routes.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { LineAskCard } from '../asks/line-ask-card.tsx';
import { lineElapsed, useNow } from './line-time.ts';
import { WorkProcess, WorkRequest, WorkResults } from './work-content.tsx';
import { WorkLineAction, WorkStatusGlyph, workStatusText } from './work-status.tsx';
import { WorkSupplement } from './work-supplement.tsx';
import { useWorkDetails } from './use-work-details.ts';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

export interface LineWorkDetailProps {
  lineId: string;
  navigate: (route: Route) => void;
  task?: NetworkTaskView;
  before?: ReactNode;
  actions?: ReactNode;
  hideComposer?: boolean;
}

function manualState(state: NetworkTaskView['state']): string {
  if (state === 'delivered') return '已交付';
  if (state === 'passed') return '对方已收到';
  return '你在处理';
}

export function LineWorkDetail({ lineId, navigate, task, before, actions, hideComposer = false }:
  LineWorkDetailProps): ReactNode {
  const live = useLive();
  const detail = useWorkDetails(lineId);
  const line = detail.thread.line ?? detail.data?.line ?? live.lines.lineOf(lineId);
  const asks = useStore(live.asks.store).open.filter((ask) => ask.lineId === lineId);
  const timeZone = useTimeZone();
  const [actionError, setActionError] = useState<string | null>(null);
  const manual = task?.direction === 'in' && task.doer === 'person';
  const now = useNow(!manual && line?.status === 'running');
  if (line === null) return <div className="work-placeholder" role={detail.error === null ? 'status' : 'alert'}>
    <p>{detail.error ?? '正在读工作…'}</p>
    {detail.error === null ? null : <button type="button" className="secondary-button"
      onClick={() => void detail.refresh()}>再读一次</button>}
  </div>;
  const elapsed = !manual && line.status === 'running' ? lineElapsed(line, now) : null;
  const results = detail.data?.results ?? [];
  const project = detail.data?.project;
  const request = task === undefined ? detail.data?.request ?? null : { text: task.goal, source: null };
  const revision = task?.direction === 'in' && task.doer === 'ai' && task.state === 'rejected';
  let stateText = line.status === 'running' ? '进行中' : workStatusText(line, timeZone);
  let stateGlyph = <WorkStatusGlyph line={line} />;
  if (revision) {
    stateText = '等你决定下一步';
    stateGlyph = <StatusGlyph status="wait" label={stateText} />;
  } else if (manual) {
    stateText = manualState(task.state);
    stateGlyph = <Icon name="person" size={14} />;
  }
  const manualDelivery = manual && ['delivered', 'passed'].includes(task.state) ? task.delivery : null;
  return <div className="work-detail" data-status={manual ? 'manual' : line.status}>
    <div className="work-scroll">
      <header className="work-title">
        <h2>{task?.title ?? line.title}</h2>
        {project == null ? null : <button type="button" className="work-project text-button"
          onClick={() => navigate({ view: 'projects', projectId: project.id, noteId: null })}>
          <Icon name="folder" size={13} />{project.title}<Icon name="chevron-right" size={12} /></button>}
      </header>
      <div className="work-state" role="status" data-status={manual ? 'manual' : line.status}>
        {stateGlyph}<span>{stateText}</span>
        {elapsed === null ? null : <span className="line-elapsed">{elapsed}</span>}
        {hideComposer || manual || line.archivedAt != null ? null
          : <WorkLineAction line={line} onError={setActionError} primary />}
      </div>
      {!manual && line.status === 'queued' ? <p className="work-state-note">等待当前工作完成</p> : null}
      {!manual && line.pauseReason === 'output_limit' ? <p className="work-state-note">
        本次输出还没写完，已有内容已保留</p> : null}
      {actionError === null ? null : <p className="work-error" role="alert">{actionError}</p>}
      {before}
      {manual ? actions : null}
      {detail.error === null ? null : <div className="work-error" role="alert">
        <span>{detail.data === null ? detail.error : '刷新失败，保留上次内容'}</span>
        <button type="button" className="text-button" onClick={() => void detail.refresh()}>再读一次</button>
      </div>}
      {detail.loading && detail.data === null ? <PageLoading rows={4} /> : null}
      <WorkRequest request={request} />
      {manual ? null : asks.map((ask) => <LineAskCard key={ask.id} ask={ask} />)}
      {!manual && line.status === 'running' && detail.thread.live?.text ? <section className="work-section">
        <h3><AiMark />正在写</h3><Markdown text={detail.thread.live.text} />
      </section> : null}
      {manual || line.activity === null ? null : <section className="work-section work-progress">
        <h3>最新进展</h3><p>{line.activity}</p>
      </section>}
      {manualDelivery === null ? null : <section className="work-section"><h3>交付结果</h3>
        <Markdown text={manualDelivery.text} /></section>}
      <WorkResults results={results} current={!manual && !revision && line.outcome === 'done' && line.queued === 0}
        hasMore={detail.data?.hasMore ?? false} loading={detail.loadingEarlier}
        onEarlier={() => void detail.earlier()} />
      {manual ? null : actions}
      <WorkProcess lineId={lineId} thread={detail.thread} />
    </div>
    {hideComposer || manual || line.archivedAt != null ? null : <WorkSupplement line={line} thread={detail.thread} />}
  </div>;
}
