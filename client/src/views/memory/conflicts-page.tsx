// 说法冲突（11-11 第二步设计稿 M3）：每晚整理时找出的几条互相矛盾的记忆。每处一行标题 + 为什么现在以哪条为准，
// 几条并排（手机上上下排），各带范围、来源、日子和所在的文档；点「以这条为准」其余进归档，也能「两条都留」或「都不要」。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { MEMORY_SOURCE_LABELS, type ConflictView, type ResolveConflictRequest } from '../../api/shared.ts';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import type { Route } from '../../shell/routes.ts';
import { invalidateQueries } from '../../state/live-query.ts';
import { ruleDay } from './rule-parts.tsx';
import { CONFLICTS_KEY, useConflicts } from './use-conflicts.ts';
import './rules.css';

function Conflict({ conflict, busy, onResolve }: { conflict: ConflictView; busy: boolean;
  onResolve: (input: Omit<ResolveConflictRequest, 'requestId' | 'version'>) => void }): ReactNode {
  return <section className="conflict" aria-labelledby={`conflict-${conflict.id}`}>
    <header className="conflict-head"><h2 id={`conflict-${conflict.id}`}>{conflict.title}</h2>
      <span className="rule-meta">{conflict.reason}</span></header>
    <div className="conflict-sides">{conflict.lines.map((line) => {
      const winner = line.id === conflict.winnerId;
      return <article key={line.id} className="conflict-side" data-winner={winner}
        aria-label={winner ? `现在以这条为准：${line.text}` : line.text}>
        <div className="conflict-tags">{winner ? <span className="conflict-win">现在以这条为准</span> : null}
          <span className="rule-chip">{line.scope}</span></div>
        <p className="conflict-text">{line.text}</p>
        <p className="rule-meta">{MEMORY_SOURCE_LABELS[line.source]} · {ruleDay(line.at)} · {line.docTitle}</p>
        <button type="button" className="secondary-button button-small" disabled={busy}
          onClick={() => onResolve({ resolution: 'kept', keepLineId: line.id })}>以这条为准</button>
      </article>;
    })}</div>
    <div className="conflict-more">
      <button type="button" className="text-button" disabled={busy}
        onClick={() => onResolve({ resolution: 'both' })}>都留着</button>
      <button type="button" className="text-button" disabled={busy}
        onClick={() => onResolve({ resolution: 'neither' })}>都不要</button>
    </div>
  </section>;
}

export function ConflictsPage({ navigate, onBack }: { navigate: (route: Route) => void;
  onBack?: (() => void) | undefined }): ReactNode {
  const api = useApi();
  const query = useConflicts();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolve = (conflict: ConflictView, input: Omit<ResolveConflictRequest, 'requestId' | 'version'>): void => {
    setBusy(conflict.id);
    setError(null);
    void api.soul.resolveConflict(conflict.id, { ...input, requestId: createRequestId(), version: conflict.version })
      .then(() => invalidateQueries((key) => key === CONFLICTS_KEY || key.startsWith('memory.')),
        (cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(null));
  };
  const conflicts = query.data?.conflicts ?? null;
  return <div className="page conflicts-page">
    <nav className="rules-crumb" aria-label="位置"><a href="#/memory" onClick={(event) => {
      event.preventDefault();
      navigate({ view: 'memory', noteId: null });
    }}>记忆</a><span aria-hidden="true">/</span></nav>
    <PageHeader title="说法冲突" onBack={onBack} phoneSearch={false}
      meta={conflicts === null || conflicts.length === 0 ? undefined : String(conflicts.length)} />
    {error === null && query.error === null ? null : <p className="rules-error" role="alert">{error ?? query.error}</p>}
    {conflicts === null ? (query.error === null ? <PageLoading /> : null)
      : conflicts.length === 0 ? <p className="tasks-empty">没有要你选的说法冲突。</p>
        : conflicts.map((conflict) => <Conflict key={conflict.id} conflict={conflict} busy={busy === conflict.id}
          onResolve={(input) => resolve(conflict, input)} />)}
  </div>;
}
