import type { ReactNode } from 'react';
import type { Route } from '../routes.ts';
import { MatesRoster } from '../../views/mates/mates-roster.tsx';

export function PlasticineColumn(props: { route: Route; navigate: (route: Route) => void }): ReactNode {
  return <MatesRoster {...props} />;
}
