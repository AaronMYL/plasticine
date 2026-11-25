import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { SpaceView } from '../../api/shared.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { LIBRARY_HOME, subscriptionRoute } from '../../shell/library-routes.ts';
import { RenameField } from '../../shell/rename-field.tsx';
import { TitlebarActions, TitlebarTitle, useInTitlebar } from '../../shell/titlebar.tsx';
import { useRoute } from '../../shell/use-route.ts';
import { useMention } from '../conversation/mention-button.tsx';
import { useSpaceActions, useUndoableDelete } from '../library/library-actions.tsx';
import { FOCUS_COMPOSER_EVENT } from '../lines/line-composer.tsx';
import { useLinkedSpace } from './use-linked-space.ts';
import { useRead } from '../memory/use-read.ts';
import { SpaceFrame } from './space-frame.tsx';
import { LegacySpace } from './space-legacy.tsx';
import { spaceRoute } from './space-links.ts';
import { useSpaceSaver } from './space-saver.ts';
import { markSpaceSeen } from './space-seen.ts';
import { ChangeBanner } from './space-change-banner.tsx';
import { SpaceTools } from './space-tools.tsx';
import { SubscriptionSheet } from './subscription-sheet.tsx';
import { useSpaceQuote } from './space-quote.ts';
import { SpaceVersions } from './space-versions.tsx';
import { SpaceExportDialog } from '../transfer/space-export-dialog.tsx';
import type { Route } from '../../shell/routes.ts';
import './spaces.css';
import './space-frame.css';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { bodyDate } from '../../shell/time-text.ts';

export interface SpacePageProps {
  spaceId: string;
  phone: boolean;
  navigate: (route: Route) => void;
}

function Crumb({ space, onOpen }: { space: SpaceView; onOpen: () => void }): ReactNode {
  if (space.subscription !== null) {
    return <button type="button" className="space-crumb text-meta" onClick={onOpen}>
      <AiMark />订阅 · {space.subscription.title}</button>;
  }
  return <span className="space-crumb text-meta">{space.author === 'ai' ? <AiMark /> : null}
    {space.genre === 'letter' ? '来信' : '空间'}</span>;
}

function useEscape(on: boolean, close: () => void): void {
  useEffect(() => {
    if (!on) return undefined;
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [on, close]);
}

export function SpacePage({ spaceId, phone, navigate }: SpacePageProps): ReactNode {
  const api = useApi();
  const { value, error, reload } = useLinkedSpace(spaceId);
  const [saved, setSaved] = useState<SpaceView | null>(null);
  useEffect(() => { if (error !== null) setSaved(null); }, [error]);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const actions = useSpaceActions();
  const undoable = useUndoableDelete();
  const mention = useMention();
  const { route, canGoBack, goBack } = useRoute();
  const titled = useInTitlebar();
  const current = saved !== null && saved.version >= (value?.version ?? 0) ? saved : value;
  const position = route.spaceId === spaceId ? route.spacePosition : undefined;
  const readRevision = useCallback(async (signal: AbortSignal) => position === undefined ? null
    : (await api.spaces.versions(spaceId, position.version, signal)).selected, [api, spaceId, position?.version]);
  const history = useRead(readRevision);
  const revision = history.value;
  const space = position === undefined ? current : revision?.version === position.version && current !== null
    ? { ...current, ...revision, id: current.id, lastChange: null } : null;
  const quoteSpace = useSpaceQuote(space);
  const saver = useSpaceSaver(space, setSaved);
  const stopEditing = useCallback(() => setEditing(false), []);
  useEscape(editing, stopEditing);
  useEffect(() => {
    if (value !== null) markSpaceSeen(value.id);
  }, [value?.id]);
  if (space === null) {
    return <div className="page space-page">
      {error === null && history.error === null ? <PageLoading rows={6} />
        : <p className="block-empty is-error" role="alert">{error ?? history.error}{' '}
          <button type="button" className="text-button" onClick={() => {
            reload();
            history.reload();
          }}>
            再读一次</button></p>}
    </div>;
  }
  const changed = (next: SpaceView | null): void => {
    if (next === null) {
      setSaved(null);
      reload();
    } else {
      setSaved(next);
    }
  };
  const leave = (): void => navigate(space.subscription === null ? LIBRARY_HOME
    : subscriptionRoute(space.subscription.id));
  const ask = (): void => {
    mention({ type: 'space', id: space.id, version: space.version, label: space.title,
      text: space.genre === 'letter' ? `回信：《${space.title}》` : `改这一页：《${space.title}》` });
    requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT)));
  };
  const tools = position !== undefined ? null : <SpaceTools space={space} phone={phone} editing={editing}
    onAsk={ask} onEdit={setEditing} onVersions={() => setVersionsOpen(true)}
    onRename={() => setRenaming(true)} onSettings={() => setSheet(true)} onExport={() => setExporting(true)}
    onDelete={() => undoable.remove(space.title, () => actions.remove(space.id), () => actions.restore(space.id),
      leave)} />;
  const back = (): void => (canGoBack ? goBack() : leave());
  let head: ReactNode;
  if (titled) {
    head = <><TitlebarTitle text={space.title} /><TitlebarActions>{tools}</TitlebarActions></>;
  } else if (phone) {
    head = <header className="space-phone-top">
      <IconButton icon="back" label="返回" onClick={back} />
      <span className="space-phone-title">{space.genre === 'letter' ? '' : space.title}</span>
      {tools}
    </header>;
  } else {
    head = <header className="space-top">
      <Crumb space={space} onOpen={() => {
        if (space.subscription !== null) navigate(subscriptionRoute(space.subscription.id));
      }} />
      <span className="grow" />
      {tools}
    </header>;
  }
  return (
    <div className="page page-fill space-page" data-phone={phone} data-genre={space.genre ?? 'legacy'}>
      {head}
      {position === undefined ? null : <div className="space-history-bar">
        <span className="text-meta">{`第 ${position.version} 版`}</span>
        <button type="button" className="text-button" onClick={() => {
          reload();
          navigate(spaceRoute(space.id));
        }}>回到最新版</button></div>}
      {renaming ? <div className="space-rename">
        <RenameField value={space.title} label={`「${space.title}」的新名字`}
          onSave={(title) => actions.rename(space.id, title).then(() => {
            setSaved(null);
            reload();
          })} onDone={() => setRenaming(false)} />
      </div> : null}
      {saver.error === null ? null : (
        <div className="banner space-banner" role="alert">
          <span className="banner-text">改的字没存上：{saver.error}</span>
          <button type="button" className="text-button" onClick={() => {
            setSaved(null);
            reload();
          }}>再读一次</button>
        </div>
      )}
      {editing || position !== undefined || saver.error !== null ? null
        : <ChangeBanner key={`${space.id}:${space.version}`} space={space} onChanged={changed} />}
      {space.html === null ? <LegacySpace space={space} phone={phone} /> : (
        <SpaceFrame className="space-frame" mode="page" label={space.title}
          editing={position === undefined && editing} onQuote={quoteSpace}
          highlightParagraph={position?.paragraph}
          space={{ html: space.html, genre: space.genre ?? 'report', title: space.title,
            dateLabel: bodyDate(space.createdAt) }} onEdit={saver.save} onEscape={stopEditing} />
      )}
      {exporting ? <SpaceExportDialog items={[space]} onClose={() => setExporting(false)} /> : null}
      {!versionsOpen || current === null ? null : <SpaceVersions space={current} phone={phone}
        onClose={() => setVersionsOpen(false)} onChanged={changed} onSelect={(version) => {
          setVersionsOpen(false);
          setEditing(false);
          navigate({ ...spaceRoute(space.id), spacePosition: { version, paragraph: 1 } });
        }} />}
      {space.subscription === null ? null : (
        <SubscriptionSheet open={sheet} subscriptionId={space.subscription.id} phone={phone}
          onClose={() => {
            setSheet(false);
            reload();
          }}
          onOpenIssue={(id) => {
            setSheet(false);
            navigate(spaceRoute(id));
          }} />
      )}
    </div>
  );
}
