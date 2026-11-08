// 订阅页（#/library/sub/<id>，2026-11-08 设计稿 Library-Subscription）：页头是图标块、名字、一行「每周五 08:00 · 还没开定时」，
// 右边没开定时时一个主按钮「开启定时」（一期都没出过时是「现在出一期」：先看样刊再开），设置（现有的订阅设置浮层）、
// ⋯（现在出一期 / 暂停）。下面是往期：第 N 期 · 结论一句 · 日期区间（样刊标「样刊」），点开那一期空间。

import { useCallback, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { IssueBrief, SubscriptionView } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { subscriptionLook } from '../../shell/columns/space-look.ts';
import { HueTile } from '../../shell/hue.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { LIBRARY_HOME } from '../../shell/library-routes.ts';
import { RevealMore, type RevealAction } from '../../shell/reveal-more.tsx';
import { TitlebarTitle } from '../../shell/titlebar.tsx';
import { useRoute } from '../../shell/use-route.ts';
import type { Route } from '../../shell/routes.ts';
import { useRead } from '../memory/use-read.ts';
import { issueLabel } from '../spaces/issue-text.ts';
import { spaceRoute } from '../spaces/space-links.ts';
import { SubscriptionSheet } from '../spaces/subscription-sheet.tsx';
import { libraryChanged, useLibraryRevision } from './library-signal.ts';
import { issueRange, subscriptionLine } from './subscription-text.ts';

export interface SubscriptionPageProps {
  subscriptionId: string;
  phone: boolean;
  navigate: (route: Route) => void;
}

/** 还没开过定时的订阅出的那几期都是样刊（看过、按反馈调好再开）。 */
function isSample(view: SubscriptionView): boolean {
  return view.status === 'draft' || view.status === 'sample';
}

function IssueRow({ issue, sample, timeZone, onOpen }: { issue: IssueBrief; sample: boolean; timeZone: string;
  onOpen: () => void }): ReactNode {
  return (
    <li>
      <button type="button" className="lib-issue" onClick={onOpen}>
        <span className="lib-issue-n">{issueLabel(issue)}</span>
        <span className="lib-issue-text">
          <span className="lib-issue-title">{issue.headline}</span>
          <span className="text-meta">{issueRange(issue, timeZone)}{sample ? ' · 样刊' : ''}</span>
        </span>
        <Icon name="chevron-right" size={14} />
      </button>
    </li>
  );
}

export function SubscriptionPage({ subscriptionId, phone, navigate }: SubscriptionPageProps): ReactNode {
  const api = useApi();
  const timeZone = useTimeZone();
  const revision = useLibraryRevision();
  const { canGoBack, goBack } = useRoute();
  const read = useCallback((signal: AbortSignal) => api.subscriptions.get(subscriptionId, signal),
    // revision 变了（资料库里改了名、删了一期）就重读：多依赖一个计数是故意的。
    [api, subscriptionId, revision]);
  const { value, error, reload } = useRead(read);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  if (value === null) {
    return <div className="page lib-page">
      {error === null ? <p className="block-empty" role="status">正在读…</p>
        : <p className="block-empty is-error" role="alert">{error}{' '}
          <button type="button" className="text-button" onClick={reload}>重新读取</button></p>}
    </div>;
  }
  const view = value;
  const act = (work: () => Promise<unknown>, done: string | null): void => {
    setBusy(true);
    setNote(null);
    work().then(() => {
      if (done !== null) setNote({ text: done, failed: false });
      reload();
      libraryChanged();
    }, (cause: unknown) => setNote({ text: errorText(cause), failed: true })).finally(() => setBusy(false));
  };
  const runNow = (): void => act(() => api.subscriptions.run(view.id, { requestId: createRequestId(),
    ...(view.kind === 'review' ? { edition: 'daily' as const } : {}) }), '在写了，写好会出现在往期里。');
  const setStatus = (status: 'active' | 'paused'): void => act(() => api.subscriptions.update(view.id, {
    requestId: createRequestId(), version: view.version, status }), null);
  const look = subscriptionLook(view.kind);
  const sample = isSample(view);
  const more: RevealAction[] = [{ icon: 'refresh', label: '现在出一期', disabled: busy, onSelect: runNow }];
  if (view.status === 'active') {
    more.push({ icon: 'pause', label: '暂停', disabled: busy, onSelect: () => setStatus('paused') });
  }
  const primary = view.status === 'active' ? null : view.issues.length === 0
    ? <button type="button" className="primary-button" disabled={busy} onClick={runNow}>现在出一期</button>
    : <button type="button" className="primary-button" disabled={busy} onClick={() => setStatus('active')}>
      开启定时</button>;
  return (
    <div className="page lib-page lib-sub" data-phone={phone}>
      {/* 桌面客户端的标题栏写订阅名（不写壳按地址算的「资料库」）；网页版、手机没有标题栏，这行什么也不画。 */}
      <TitlebarTitle text={view.title} />
      <header className="lib-sub-head">
        {phone ? <IconButton icon="back" label="回到上一页" className="page-back"
          onClick={() => (canGoBack ? goBack() : navigate(LIBRARY_HOME))} /> : null}
        <HueTile hue={look.hue} icon={look.icon} size={36} />
        <div className="lib-sub-title">
          <h1>{view.title}</h1>
          <p className="text-meta">{subscriptionLine(view)}</p>
        </div>
        <div className="lib-sub-actions">
          {phone ? null : primary}
          <IconButton icon="sliders" label="订阅设置" aria-haspopup="dialog" onClick={() => setSheet(true)} />
          <RevealMore label={`「${view.title}」的更多操作`} actions={more} />
        </div>
      </header>
      {phone && primary !== null ? <div className="lib-sub-primary">{primary}</div> : null}
      {note === null ? null : <p className={note.failed ? 'lib-note is-error' : 'lib-note text-meta'}
        role={note.failed ? 'alert' : 'status'}>{note.text}</p>}
      {view.issues.length === 0 ? <p className="block-empty">还没出过一期。</p> : (
        <ul className="lib-issues" aria-label="往期">
          {view.issues.map((issue) => <IssueRow key={issue.spaceId} issue={issue} sample={sample}
            timeZone={timeZone} onOpen={() => navigate(spaceRoute(issue.spaceId))} />)}
        </ul>
      )}
      <SubscriptionSheet open={sheet} subscriptionId={view.id} phone={phone} onClose={() => {
        setSheet(false);
        reload();
        libraryChanged();
      }} onOpenIssue={(id) => {
        setSheet(false);
        navigate(spaceRoute(id));
      }} />
    </div>
  );
}
