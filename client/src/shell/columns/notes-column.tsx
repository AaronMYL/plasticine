import type { ReactNode } from 'react';
import { NotesListColumn } from '../../views/notes/notes-column-list.tsx';
import type { Route } from '../routes.ts';

export function NotesColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  return <NotesListColumn route={route} navigate={navigate} />;
}
