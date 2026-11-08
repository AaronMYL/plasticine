// 一个订阅（设计稿 Library-Subscription）：浮层里三段——最新一期、往期、设置。设置改完点「保存」；没开定时的
// 先「现在出一期」看样刊，看过再「开定时」；开着的能「暂停订阅」。

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { IssueBrief, SubscriptionSettings, SubscriptionView } from '../../api/shared.ts';
import { HueTile } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { useRead } from '../memory/use-read.ts';
import { issueDate, issueLabel, issueStats } from './issue-text.ts';
import { SubscriptionFields } from './subscription-settings.tsx';

type Tab = 'latest' | 'issues' | 'settings';

export interface SubscriptionSheetProps {
  open: boolean;
  subscriptionId: string;
  phone: boolean;
  initialTab?: Tab;
  onClose: () => void;
  onOpenIssue: (spaceId: string) => void;
}

function IssueRow({ issue, onOpen }: { issue: IssueBrief; onOpen: () => void }): ReactNode {
  return (
    <li><button type="button" className="sub-issue" onClick={onOpen}>
      <span className="sub-issue-n">{issueLabel(issue)}</span>
      <span className="sub-issue-title">{issue.headline}</span>
      <span className="text-meta">{issueDate(issue)}</span>
      <Icon name="chevron-right" size={14} />
    </button></li>
  );
}

function Latest({ issue, onOpen }: { issue: IssueBrief | undefined; onOpen: (id: string) => void }): ReactNode {
  if (issue === undefined) {
    return <p className="block-empty">还没出过一期。</p>;
  }
  return (
    <div className="sub-latest">
      <p className="text-meta">{issueLabel(issue)} · {issueDate(issue)}</p>
      <h3>{issue.headline}</h3>
      {issue.stats.length === 0 ? null : <p className="text-meta">{issueStats(issue)}</p>}
      <button type="button" className="secondary-button" onClick={() => onOpen(issue.spaceId)}>打开</button>
    </div>
  );
}

export function SubscriptionSheet(props: SubscriptionSheetProps): ReactNode {
  const api = useApi();
  const read = useCallback((signal: AbortSignal) => api.subscriptions.get(props.subscriptionId, signal),
    [api, props.subscriptionId]);
  const { value, error, reload } = useRead(read);
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'settings');
  const [draft, setDraft] = useState<SubscriptionSettings | null>(null);
  const [current, setCurrent] = useState<SubscriptionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  const view = current !== null && current.version >= (value?.version ?? 0) ? current : value;
  useEffect(() => {
    if (props.open) {
      reload();
      setTab(props.initialTab ?? 'settings');
      setDraft(null);
      setProblem(null);
      setRan(false);
    }
  }, [props.open, props.initialTab, reload]);
  const settings = draft ?? view?.settings ?? null;
  const send = (work: (subscription: SubscriptionView) => Promise<SubscriptionView>): void => {
    if (view === null) return;
    setBusy(true);
    setProblem(null);
    void work(view).then((next) => {
      setCurrent(next);
      setDraft(null);
    }, (cause: unknown) => setProblem(errorText(cause))).finally(() => setBusy(false));
  };
  const save = (): void => send((sub) => api.subscriptions.update(sub.id, { requestId: createRequestId(),
    version: sub.version, ...(draft === null ? {} : { settings: draft }) }));
  const setStatus = (status: 'active' | 'paused'): void => send((sub) => api.subscriptions.update(sub.id, {
    requestId: createRequestId(), version: sub.version, ...(draft === null ? {} : { settings: draft }), status }));
  const runNow = (): void => {
    if (view === null) return;
    setBusy(true);
    setProblem(null);
    void api.subscriptions.run(view.id, { requestId: createRequestId(),
      ...(view.kind === 'review' ? { edition: 'daily' as const } : {}) })
      .then(() => setRan(true), (cause: unknown) => setProblem(errorText(cause))).finally(() => setBusy(false));
  };
  const footer = view === null || tab !== 'settings' ? null : (
    <footer className="sub-foot">
      {problem === null ? (ran ? <span className="text-meta grow" role="status">在写了，写好会出现在往期里</span>
        : <span className="grow" />) : <span className="sub-problem grow" role="alert">{problem}</span>}
      {view.status === 'active' ? <button type="button" className="text-button text-button-quiet" disabled={busy}
        onClick={() => setStatus('paused')}>暂停订阅</button> : <>
        <button type="button" className="text-button text-button-quiet" disabled={busy} onClick={runNow}>现在出一期</button>
        {view.issues.length > 0 ? <button type="button" className="secondary-button" disabled={busy}
          onClick={() => setStatus('active')}>开定时</button> : null}
      </>}
      <button type="button" className="primary-button" disabled={busy || draft === null} onClick={save}>保存</button>
    </footer>
  );
  const tabs: [Tab, string][] = [['latest', '最新一期'], ['issues', '往期'], ['settings', '设置']];
  return (
    <Sheet open={props.open} variant={props.phone ? 'drawer' : 'panel'} title={view?.title ?? '订阅'}
      onClose={props.onClose} state={view === null ? (error === null ? 'loading' : 'failed') : undefined}
      error={error ?? undefined} className="sub-sheet">
      {view === null || settings === null ? null : <>
        <div className="sub-head">
          <HueTile hue={view.kind === 'review' ? 'teal' : 'sky'} icon={view.kind === 'review' ? 'sparkle' : 'chart'} />
          <div className="segmented" role="group" aria-label="看哪一段">
            {tabs.map(([id, label]) => <button key={id} type="button" className="segmented-item"
              aria-pressed={tab === id} onClick={() => setTab(id)}>{label}
              {id === 'issues' && view.issues.length > 0 ? <span className="seg-count">{view.issues.length}</span>
                : null}</button>)}
          </div>
        </div>
        {tab === 'latest' ? <Latest issue={view.issues[0]} onOpen={props.onOpenIssue} /> : null}
        {tab === 'issues' ? <ul className="sub-issues">{view.issues.map((issue) => <IssueRow key={issue.spaceId}
          issue={issue} onOpen={() => props.onOpenIssue(issue.spaceId)} />)}</ul> : null}
        {tab === 'settings' ? <div className="sub-fields">
          <SubscriptionFields settings={settings} onChange={setDraft} />
        </div> : null}
        {footer}
      </>}
    </Sheet>
  );
}
