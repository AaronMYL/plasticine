// 笔记栏目的第二栏：11-06 起是文件夹；11-15 界面统一（Aaron 弹框定「两栏合成一栏」）起就是笔记列表，文件夹从列表顶上的
// 文件夹名点开（views/notes/notes-column-list.tsx）。选哪个文件夹、搜什么记在 NotesUi，和主区的正文共用一份。

import type { ReactNode } from 'react';
import { NotesListColumn } from '../../views/notes/notes-column-list.tsx';
import type { Route } from '../routes.ts';

export function NotesColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  return <NotesListColumn route={route} navigate={navigate} />;
}
