import { BulkHeader, BulkCheck, BulkBar, BulkFeedback } from '../bulk/bulk-controls.tsx';
import { useBulkSelection, type BulkSelection } from '../bulk/use-bulk-selection.ts';
import { libraryBatch } from '../bulk/bulk-api.ts';
import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { SkippedFileView, SpaceListItem } from '../../api/shared.ts';
import { SkippedFiles } from '../transfer/skipped-files.tsx';
import { SpaceExportDialog, type ExportItem } from '../transfer/space-export-dialog.tsx';
import { importSpaceFiles, SPACE_IMPORT_ACCEPT } from '../transfer/space-import.ts';
import { useFilePicker } from '../transfer/use-file-picker.tsx';
import { useQuery } from '../../state/use-query.ts';
import type { LiveEvent } from '../../api/types.ts';
import { useClientState } from '../../state/context.tsx';
import { useLibraryTrash, useSubscriptionList } from '../../shell/columns/library-subscriptions.tsx';
import { subscriptionLook } from '../../shell/columns/space-look.ts';
import { HueTile } from '../../shell/hue.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { LIBRARY_TRASH, subscriptionRoute } from '../../shell/library-routes.ts';
import { PageHeader } from '../../shell/page-header.tsx';
import { RenameField } from '../../shell/rename-field.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { routeHash, type Route } from '../../shell/routes.ts';
import { useInTitlebar } from '../../shell/titlebar.tsx';
import { spaceRoute } from '../spaces/space-links.ts';
import { SpaceThumb } from '../spaces/space-thumb.tsx';
import { groupSpaces, spaceCategoryLabel } from './space-categories.ts';
import { useSpaceActions, useUndoableDelete } from './library-actions.tsx';
import { libraryChanged } from './library-signal.ts';
import './library.css';
import './library-grid.css';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { timeText } from '../../shell/time-text.ts';

const RECENT_COUNT = 3;
const SPACE_EVENTS: ReadonlySet<LiveEvent['type']> = new Set(['space.changed']);

function useAllSpaces(): { spaces: SpaceListItem[] | null; error: string | null } {
  const api = useApi();
  const query = useQuery('spaces.list', (signal) => api.spaces.list(signal).then((result) => result.spaces),
    SPACE_EVENTS);
  return { spaces: query.data, error: query.error };
}

interface CardProps {
  space: SpaceListItem;
  now: Date;
  onDelete: (space: SpaceListItem) => void;
  onExport: (space: SpaceListItem) => void;
  selection: BulkSelection;
}

function SpaceCard({ space, now, onDelete, onExport, selection }: CardProps): ReactNode {
  const actions = useSpaceActions();
  const [renaming, setRenaming] = useState(false);
  const meta = `${spaceCategoryLabel(space)} · ${timeText(space.updatedAt, now)}`;
  return (
    <li className="lib-card" data-genre={space.genre ?? 'legacy'}>
      {selection.active ? <span className="bulk-card-check"><BulkCheck selection={selection}
        item={{ kind: 'space', id: space.id, title: space.title }} /></span> : null}
      <a onClick={(event) => { if (selection.active) { event.preventDefault();
        selection.toggle({ kind: 'space', id: space.id, title: space.title }, event.shiftKey); } }}
        className="lib-card-link" href={routeHash(spaceRoute(space.id))} aria-label={space.title}
        tabIndex={renaming ? -1 : undefined}>
        <SpaceThumb spaceId={space.id} version={space.version} />
      </a>
      {renaming ? (
        <RenameField value={space.title} label={`「${space.title}」的新名字`}
          onSave={(title) => actions.rename(space.id, title)} onDone={() => setRenaming(false)} />
      ) : <a className="lib-card-title" href={routeHash(spaceRoute(space.id))} tabIndex={-1} aria-hidden="true">
        {space.title}</a>}
      <div className="lib-card-meta">
        <span className="text-meta">{meta}</span>
        <RevealMore label={`「${space.title}」的更多操作`} actions={renaming || selection.active ? [] : [
          { icon: 'edit', label: '改名', onSelect: () => setRenaming(true) },
          { icon: 'download', label: '导出…', onSelect: () => onExport(space) },
          { icon: 'trash', label: '删除', danger: true, onSelect: () => onDelete(space) },
        ]} />
      </div>
    </li>
  );
}

function PhoneExtras({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const { subscriptions } = useSubscriptionList();
  const { trash } = useLibraryTrash();
  const count = trash?.items.length ?? 0;
  return (
    <>
      {subscriptions === null || subscriptions.length === 0 ? null : <section aria-label="订阅" className="lib-grid-sec">
        <h2 className="lib-grid-head">订阅</h2>
        <ul className="spaces-rows">
          {subscriptions.map((item) => {
            const look = subscriptionLook(item.kind);
            return (
              <li key={item.id}>
                <button type="button" className="spaces-row" onClick={() => navigate(subscriptionRoute(item.id))}>
                  <HueTile hue={look.hue} icon={look.icon} />
                  <span className="spaces-row-title">{item.title}</span>
                  {item.issueCount === 0 ? null : <span className="lib-count">{item.issueCount}</span>}
                  <Icon name="chevron-right" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>}
      <ul className="spaces-rows lib-trash-link">
        <li>
          <button type="button" className="spaces-row" onClick={() => navigate(LIBRARY_TRASH)}>
            <span className="lib-trash-icon"><Icon name="trash" size={16} /></span>
            <span className="spaces-row-title">最近删除</span>
            {count === 0 ? null : <span className="lib-count">{count}</span>}
            <Icon name="chevron-right" size={14} />
          </button>
        </li>
      </ul>
    </>
  );
}

export function LibraryHome({ phone, navigate }: { phone: boolean; navigate: (route: Route) => void }): ReactNode {
  const { spaces, error } = useAllSpaces();
  const api = useApi();
  const groups = groupSpaces(spaces ?? []);
  const bulkItems = groups.flatMap((group) => group.spaces).map((space) => ({
    kind: 'space' as const, id: space.id, title: space.title }));
  const selection = useBulkSelection({ items: bulkItems, run: (input) => libraryBatch(api.library, input),
    onChanged: libraryChanged });
  const actions = useSpaceActions();
  const undoable = useUndoableDelete();
  const titled = useInTitlebar();
  const { shellPrefs } = useClientState();
  const now = new Date();
  const [exporting, setExporting] = useState<readonly ExportItem[] | null>(null);
  const [skipped, setSkipped] = useState<SkippedFileView[]>([]);
  const picker = useFilePicker({ accept: SPACE_IMPORT_ACCEPT, label: '选要导入资料库的文件', onFiles: (files) => {
    setSkipped([]);
    void importSpaceFiles(api, files, libraryChanged).then((left) => setSkipped(left ?? []));
  } });
  const remove = (space: SpaceListItem): void => undoable.remove(space.title, () => actions.remove(space.id),
    () => actions.restore(space.id));
  const cards = (list: readonly SpaceListItem[]): ReactNode[] => list.map((space) => (
    <SpaceCard key={space.id} space={space} now={now} onDelete={remove} selection={selection}
      onExport={(item) => setExporting([item])} />));
  const ask = <IconButton icon="plus" label="新空间：跟 Plasticine 说"
    onClick={() => shellPrefs.setPhoneChatOpen(true)} />;
  return (
    <div className="page lib-page lib-grid-page" data-phone={phone}>
      {titled ? null : <PageHeader title="资料库" phoneSearch={false} phoneTools={ask} />}
      <BulkHeader selection={selection} items={bulkItems}
        more={[{ icon: 'upload', label: '导入…', onSelect: picker.open }]} />
      <BulkFeedback selection={selection} />
      <SkippedFiles files={skipped} onClose={() => setSkipped([])} />
      {picker.input}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      {spaces === null && error === null ? <PageLoading page /> : null}
      {spaces !== null && spaces.length === 0 ? <p className="block-empty">还没有空间。</p> : null}
      {spaces === null || spaces.length === 0 ? null : <>
        {selection.active ? null : <section aria-label="最近" className="lib-grid-sec">
          <h2 className="lib-grid-head">最近</h2>
          <ul className="lib-cards lib-recent">{cards(spaces.slice(0, RECENT_COUNT))}</ul>
        </section>}
        <section aria-label="全部" className="lib-grid-sec">
          <h2 className="lib-grid-head">全部<span className="lib-grid-count">{spaces.length}</span></h2>
          {groups.map((group) => <section key={group.category} className="lib-grid-sec"
            aria-label={group.label}><h3 className="lib-category-head">{group.label}</h3>
            <ul className="lib-cards lib-all">{cards(group.spaces)}</ul></section>)}
        </section>
      </>}
      {phone ? <PhoneExtras navigate={navigate} /> : null}
      <BulkBar selection={selection} folders={[...new Set((spaces ?? []).flatMap((space) =>
        space.folder ? [space.folder] : []))]} onExport={(items) => setExporting(items)} />
      {exporting === null ? null : <SpaceExportDialog items={exporting} onClose={() => setExporting(null)} />}
    </div>
  );
}
