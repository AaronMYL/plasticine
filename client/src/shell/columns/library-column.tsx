import type { ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { FileEntryView, SpaceListItem } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useQuery } from '../../state/use-query.ts';
import type { LiveEvent } from '../../api/types.ts';
import { groupSpaces } from '../../views/library/space-categories.ts';
import { IconButton } from '../icon-button.tsx';
import { Icon } from '../icons.tsx';
import type { Route } from '../routes.ts';
import { ColumnFoot, ColumnHead, ColumnLabel, ColumnNote } from './column.tsx';
import { SubscriptionRows, TrashRow } from './library-subscriptions.tsx';
import { SpaceRows } from './library-space-rows.tsx';

export { spaceLook } from './space-look.ts';

export interface LibraryData {
  spaces: SpaceListItem[] | null;
  folders: FileEntryView[] | null;
  error: string | null;
}

const SPACE_EVENTS: ReadonlySet<LiveEvent['type']> = new Set(['space.changed']);
const NO_EVENTS: ReadonlySet<LiveEvent['type']> = new Set();

export function useLibraryData(): LibraryData {
  const api = useApi();
  const spaces = useQuery('spaces.standalone',
    (signal) => api.spaces.list(signal, { standalone: true }).then((result) => result.spaces), SPACE_EVENTS);
  const folders = useQuery('library.folders', (signal) => api.files.list('', signal)
    .then((result) => result.entries.filter((entry) => entry.kind === 'directory')), NO_EVENTS);
  return { spaces: spaces.data, folders: folders.data, error: spaces.error ?? folders.error };
}

export function LibraryColumn({ route, navigate, onAsk }: { route: Route; navigate: (route: Route) => void;
  onAsk: () => void }): ReactNode {
  const live = useLive();
  const data = useLibraryData();
  const spaceId = route.view === 'books' ? route.spaceId ?? null : null;
  const openFolder = (path: string): void => {
    live.toolGroups.folder.set(path);
    void live.toolGroups.files.reset();
    navigate({ view: 'tools', noteId: null, tool: '文件' });
  };
  return (
    <>
      <ColumnHead title="资料库">
        <IconButton icon="plus" label="新空间：跟 Plasticine 说" onClick={onAsk} />
      </ColumnHead>
      <div className="column-scroll">
        {data.error === null ? null : <ColumnNote>{data.error}</ColumnNote>}
        <SubscriptionRows route={route} navigate={navigate} />
        {groupSpaces(data.spaces ?? []).map((group) => <section key={group.category} aria-label={group.label}>
          <ColumnLabel>{group.label}</ColumnLabel>
          <SpaceRows spaces={group.spaces} current={spaceId} navigate={navigate} />
        </section>)}
        {data.folders === null || data.folders.length === 0 ? null : <>
          <ColumnLabel>文件</ColumnLabel>
          {data.folders.map((folder) => (
            <button key={folder.path} type="button" className="column-item" onClick={() => openFolder(folder.path)}>
              <span className="column-item-lead"><Icon name="folder" size={16} /></span>
              <span className="column-item-text">{folder.name}</span>
            </button>
          ))}
        </>}
      </div>
      <ColumnFoot><TrashRow route={route} navigate={navigate} /></ColumnFoot>
    </>
  );
}
