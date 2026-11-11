// 资料库栏目的第二栏（11-07 设计稿 Library-Space，11-08 Library-Subscription）：「订阅」（个人回顾、研究周报，带往期数，
// library-subscriptions.tsx）、「空间」（不属于订阅的报告、核查、整理稿，类别色图标块；行尾 ⋯ 改名 / 打开 / 删除，
// library-space-rows.tsx）、「文件」（工作目录最上一层的文件夹），底部「最近删除」。图书 11-11 起在阅读栏（reading-column.tsx）。
// 顶上 +：新空间跟 Plasticine 说（对话框展开）。
// 数据：GET /v2/subscriptions、GET /v2/spaces?standalone=true、GET /v2/files、GET /v2/library/trash。
// 手机上没有第二栏，「更多 · 资料库」打开资料库首页（#/library）。

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
import { ColumnFoot, ColumnHead, ColumnLabel, ColumnLink, ColumnNote } from './column.tsx';
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

/** 第二栏：单独的空间（不属于订阅的）和文件夹；和资料库首页一样走共用缓存，回来直接画。 */
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
    live.m5b.folder.set(path);
    void live.m5b.files.reset();
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
