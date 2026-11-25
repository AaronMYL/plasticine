import { Suspense, type ReactNode } from 'react';
import type { BooksPageProps } from '../views/books/books-page.tsx';
import type { LibraryPageProps } from '../views/library/library-page.tsx';
import { ProjectsPage } from '../views/projects/projects-page.tsx';
import { FeedPage } from '../views/feed/feed-page.tsx';
import type { MemoryPageProps } from '../views/memory/memory-page.tsx';
import type { NotesViewProps } from '../views/notes/notes-view.tsx';
import type { SkillsPageProps } from '../views/skills/skills-page.tsx';
import { HomeView } from '../views/home/home-view.tsx';
import { MessagesPage } from '../views/messages/messages-page.tsx';
import { PlasticinePage } from '../views/plasticine/plasticine-page.tsx';
import { TasksPage } from '../views/tasks/tasks-page.tsx';
import { PageLoading } from '../primitives/page-loading/index.tsx';
import { lazyView } from './lazy-view.ts';
import { phonePageAvailable, type Route, type ToolName } from './routes.ts';
import { PhoneUnavailable } from '../views/reading/phone-content.tsx';

const NotesView = lazyView<NotesViewProps>(() => import('../views/notes/notes-view.tsx'), 'NotesView');
const MemoryPage = lazyView<MemoryPageProps>(() => import('../views/memory/memory-page.tsx'), 'MemoryPage');
const SkillsPage = lazyView<SkillsPageProps>(() => import('../views/skills/skills-page.tsx'), 'SkillsPage');
const BooksPage = lazyView<BooksPageProps>(() => import('../views/books/books-page.tsx'), 'BooksPage');
const LibraryPage = lazyView<LibraryPageProps>(() => import('../views/library/library-page.tsx'), 'LibraryPage');
import { WebStart } from '../views/web/web-start.tsx';

const ToolPage = lazyView<{ tool: ToolName | null }>(() => import('../views/tools/tool-page.tsx'), 'ToolPage');

function Loading(): ReactNode {
  return <PageLoading page />;
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
      return <HomeView />;
    case 'plasticine':
    case 'conversation':
      return <PlasticinePage route={route} phone={phone} navigate={navigate} />;
    case 'messages':
    case 'contacts':
      return <MessagesPage route={route} phone={phone} navigate={navigate} />;
    case 'web':
      return <WebStart />;
    case 'notes':
      return (
        <NotesView noteId={route.noteId} invalidNoteId={route.invalidNoteId} phone={phone} navigate={navigate} />
      );
    case 'books':
      return <BooksPage bookId={route.bookId ?? null} spaceId={route.spaceId ?? null}
        spacesList={route.spacesList === true} position={route.bookPosition ?? null} phone={phone}
        navigate={navigate} />;
    case 'library':
      return <LibraryPage route={route} phone={phone} navigate={navigate} />;
    case 'projects':
      return <ProjectsPage projectId={route.projectId ?? null} phone={phone} navigate={navigate} onBack={onBack} />;
    case 'memory':
      return <MemoryPage route={route} phone={phone} navigate={navigate} onBack={onBack} />;
    case 'skills':
      return <SkillsPage route={route} phone={phone} navigate={navigate} onBack={onBack} />;
    case 'feed':
      return <FeedPage />;
    case 'work':
      return null;
    case 'settings':
      return null;
    case 'tools':
      return <ToolPage tool={route.tool ?? null} />;
    case 'tasks':
      return <TasksPage section={route.tasksSection ?? 'run'} phone={phone} navigate={navigate} />;
  }
}
