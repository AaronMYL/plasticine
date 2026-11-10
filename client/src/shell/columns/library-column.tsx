// 资料库栏目的第二栏（11-07 设计稿 Library-Space，11-08 Library-Subscription）：「订阅」（个人回顾、研究周报，带往期数，
// library-subscriptions.tsx）、「空间」（不属于订阅的报告、核查、整理稿，类别色图标块；行尾 ⋯ 改名 / 打开 / 删除，
// library-space-rows.tsx）、「文件」（工作目录最上一层的文件夹），底部「最近删除」。图书 11-08 起单独一栏（books-column.tsx）。
// 顶上 +：新空间跟 Plasticine 说（对话框展开）。
// 数据：GET /v2/subscriptions、GET /v2/spaces?standalone=true、GET /v2/files、GET /v2/library/trash。
// 手机上没有第二栏，「更多 · 资料库」打开资料库首页（#/library）。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { FileEntryView, SpaceListItem } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useLibraryRevision } from '../../views/library/library-signal.ts';
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

export function useLibraryData(): LibraryData {
  const api = useApi();
  const live = useLive();
  const [data, setData] = useState<LibraryData>({ spaces: null, folders: null, error: null });
  const [round, setRound] = useState(0);
  const revision = useLibraryRevision();
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'resync' || event.type === 'space.changed') {
      setRound((value) => value + 1);
    }
  }), [live.hub]);
  useEffect(() => {
    const controller = new AbortController();
    const fail = (cause: unknown): void => {
      if (!controller.signal.aborted) setData((previous) => ({ ...previous, error: errorText(cause) }));
    };
    api.spaces.list(controller.signal, { standalone: true }).then((result) => setData((previous) => ({ ...previous,
      spaces: result.spaces })), fail);
    api.files.list('', controller.signal).then((result) => setData((previous) => ({ ...previous,
      folders: result.entries.filter((entry) => entry.kind === 'directory') })), fail);
    return () => controller.abort();
  }, [api, round, revision]);
  return data;
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
