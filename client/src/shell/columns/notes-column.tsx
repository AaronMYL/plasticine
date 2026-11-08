// 笔记栏目的第二栏（11-06 定）：文件夹，只放他自己写的（「Plasticine 写的」在资料库的空间里）；顶上 + 新建一篇。
// 选哪个文件夹记在 NotesUi（和主区的列表共用一份），点了主区回到这个文件夹的列表。

import type { ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { NoteFolders } from '../../views/notes/note-folders.tsx';
import { IconButton } from '../icon-button.tsx';
import type { Route } from '../routes.ts';
import { ColumnHead } from './column.tsx';

export function NotesColumn({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const { notesUi } = useClientState();
  const ui = useStore(notesUi.store);
  return (
    <>
      <ColumnHead title="笔记">
        <IconButton icon="plus" label="新建笔记" onClick={() => navigate({ view: 'notes', noteId: 'new' })} />
      </ColumnHead>
      <div className="column-scroll">
        <NoteFolders column value={ui.collection} onChange={(collection) => {
          notesUi.set({ collection, activeNoteId: null, reading: true });
          navigate({ view: 'notes', noteId: null });
        }} />
      </div>
    </>
  );
}
