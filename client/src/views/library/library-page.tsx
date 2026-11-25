import type { ReactNode } from 'react';
import type { Route } from '../../shell/routes.ts';
import { LibraryHome } from './library-home.tsx';
import { SubscriptionPage } from './subscription-page.tsx';
import { TrashPage } from './trash-page.tsx';
import '../spaces/spaces.css';
import './library.css';

export interface LibraryPageProps {
  route: Route;
  phone: boolean;
  navigate: (route: Route) => void;
}

export function LibraryPage({ route, phone, navigate }: LibraryPageProps): ReactNode {
  if (route.libraryTrash === true) {
    return <TrashPage />;
  }
  if (route.subscriptionId != null) {
    return <SubscriptionPage key={route.subscriptionId} subscriptionId={route.subscriptionId} phone={phone}
      navigate={navigate} />;
  }
  return <LibraryHome phone={phone} navigate={navigate} />;
}
