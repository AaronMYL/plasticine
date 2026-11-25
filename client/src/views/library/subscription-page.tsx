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
import { RevealMore } from '../../shell/reveal-more.tsx';
import { TitlebarActions, TitlebarTitle, useInTitlebar } from '../../shell/titlebar.tsx';
import { useRoute } from '../../shell/use-route.ts';
import type { Route } from '../../shell/routes.ts';
import { useRead } from '../memory/use-read.ts';
import { issueLabel } from '../spaces/issue-text.ts';
import { spaceRoute } from '../spaces/space-links.ts';
import { useSubscriptionMenu } from './subscription-menu.tsx';
import { libraryChanged, useLibraryRevision } from './library-signal.ts';
import { issueRange, subscriptionLine } from './subscription-text.ts';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

export interface SubscriptionPageProps {
  subscriptionId: string;
  phone: boolean;
  navigate: (route: Route) => void;
}

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
    [api, subscriptionId, revision]);
  const { value, error, reload } = useRead(read);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  const menu = useSubscriptionMenu(phone, navigate, reload);
  if (value === null) {
    return <div className="page lib-page">
      {error === null ? <PageLoading page />
        : <p className="block-empty is-error" role="alert">{error}{' '}
          <button type="button" className="text-button" onClick={reload}>再读一次</button></p>}
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
  const more = menu.actions(view);
  const primary = view.status === 'active' ? null : view.issues.length === 0
    ? <button type="button" className="primary-button" disabled={busy} onClick={runNow}>现在出一期</button>
    : <button type="button" className="primary-button" disabled={busy} onClick={() => setStatus('active')}>
      开启定时</button>;
  const titled = useInTitlebar() && !phone;
  const actions = <>
    {phone ? null : primary}
    <RevealMore label={`「${view.title}」的更多操作`} actions={more} />
  </>;
  return (
    <div className="page lib-page lib-sub" data-phone={phone}>
      <TitlebarTitle text={view.title} />
      {titled ? <TitlebarActions>{actions}</TitlebarActions> : null}
      <header className="lib-sub-head">
        {phone ? <IconButton icon="back" label="回到上一页" className="page-back"
          onClick={() => (canGoBack ? goBack() : navigate(LIBRARY_HOME))} /> : null}
        <HueTile hue={look.hue} icon={look.icon} size={36} />
        <div className="lib-sub-title">
          <h1 className={titled ? 'sr-only' : undefined}>{view.title}</h1>
          <p className="text-meta">{subscriptionLine(view)}</p>
        </div>
        {titled ? null : <div className="lib-sub-actions">{actions}</div>}
        {menu.dialogs}
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
    </div>
  );
}
