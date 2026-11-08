// 主区当前视图：按路由挑一个（两层侧栏的主区只放当前打开的那一个东西）。2026-11-05 任务、关切、成果页删了（旧地址在 routes.ts 里落到新页面）。
// 笔记（TipTap）、记忆、图书三页按路由懒加载（用户视角审查 2026-11-01 第 16 条 ④），首包不带它们。

import { Suspense, type ReactNode } from 'react';
import type { BooksPageProps } from '../views/books/books-page.tsx';
import { ProjectsPage } from '../views/projects/projects-page.tsx';
import { FeedPage } from '../views/feed/feed-page.tsx';
import type { MemoryPageProps } from '../views/memory/memory-page.tsx';
import type { NotesViewProps } from '../views/notes/notes-view.tsx';
import { HomeView } from '../views/home/home-view.tsx';
import { MessagesPage } from '../views/messages/messages-page.tsx';
import { PlasticinePage } from '../views/plasticine/plasticine-page.tsx';
import { TasksPage } from '../views/tasks/tasks-page.tsx';
import { LOADING_TEXT, lazyView } from './lazy-view.ts';
import { phonePageAvailable, type Route, type ToolName } from './routes.ts';
import { PhoneUnavailable } from '../views/reading/phone-content.tsx';

const NotesView = lazyView<NotesViewProps>(() => import('../views/notes/notes-view.tsx'), 'NotesView');
const MemoryPage = lazyView<MemoryPageProps>(() => import('../views/memory/memory-page.tsx'), 'MemoryPage');
const BooksPage = lazyView<BooksPageProps>(() => import('../views/books/books-page.tsx'), 'BooksPage');
import { WebStart } from '../views/web/web-start.tsx';

const ToolPage = lazyView<{ tool: ToolName | null }>(() => import('../views/tools/tool-page.tsx'), 'ToolPage');

function Loading(): ReactNode {
  return <p className="block-empty page-loading">{LOADING_TEXT}</p>;
}

export interface CurrentViewProps {
  route: Route;
  phone: boolean;
  navigate: (route: Route) => void;
  onBack?: (() => void) | undefined;
}

export function CurrentView(props: CurrentViewProps): ReactNode {
  return <Suspense fallback={<Loading />}><RoutedView {...props} /></Suspense>;
}

function RoutedView({ route, phone, navigate, onBack }: CurrentViewProps): ReactNode {
  if (phone && !phonePageAvailable(route)) {
    return <PhoneUnavailable route={route} navigate={navigate} onBack={onBack} />;
  }
  switch (route.view) {
    case 'today':
      // 2026-11-02 第 102 条：「今日」改名「首页」；2026-11-03 旧版今日去掉，原来的五块都并进了首页。
      return <HomeView />;
    case 'plasticine':
    case 'conversation':
      // 主线和旁聊（11-07 两层侧栏）；旧的 conversation 地址解析时已经换成 plasticine，这里只为类型完整。
      return <PlasticinePage route={route} phone={phone} navigate={navigate} />;
    case 'messages':
    case 'contacts':
      return <MessagesPage route={route} phone={phone} navigate={navigate} />;
    case 'web':
      // 网页标签由壳画（shell.tsx），没选标签时是网页的开始页。
      return <WebStart />;
    case 'notes':
      return (
        <NotesView noteId={route.noteId} invalidNoteId={route.invalidNoteId} phone={phone} navigate={navigate} />
      );
    case 'books':
      return <BooksPage bookId={route.bookId ?? null} spaceId={route.spaceId ?? null}
        spacesList={route.spacesList === true} position={route.bookPosition ?? null} phone={phone}
        navigate={navigate} />;
    case 'projects':
      return <ProjectsPage projectId={route.projectId ?? null} phone={phone} navigate={navigate} onBack={onBack} />;
    case 'memory':
      return <MemoryPage route={route} phone={phone} navigate={navigate} onBack={onBack} />;
    case 'feed':
      return <FeedPage />;
    case 'work':
      // 由壳显示同一工作详情，手机使用全屏 Sheet。
      return null;
    case 'settings':
      // 2026-11-05 起设置是弹框：这种地址壳一认到就开弹框、底下照旧画当前标签（shell.tsx），走不到这里。
      return null;
    case 'tools':
      return <ToolPage tool={route.tool ?? null} />;
    case 'tasks':
      return <TasksPage section={route.tasksSection ?? 'run'} phone={phone} navigate={navigate} />;
  }
}
