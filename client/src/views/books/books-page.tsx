import type { ReactNode } from 'react';
import type { BookRoutePosition, Route } from '../../shell/routes.ts';
import { Library } from './library.tsx';
import { Reader } from './reader.tsx';
import { SpacePage } from '../spaces/space-page.tsx';
import { SpacesList } from '../spaces/spaces-list.tsx';
import './books.css';
import './reader.css';
import './reader-paged.css';
import './reader-popovers.css';
import './book-sheet.css';

export interface BooksPageProps {
  bookId: string | null;
  spaceId?: string | null;
  spacesList?: boolean;
  position: BookRoutePosition | null;
  phone: boolean;
  navigate: (route: Route) => void;
}

export function BooksPage({ bookId, spaceId = null, spacesList = false, position, phone, navigate }: BooksPageProps)
  : ReactNode {
  if (spacesList) {
    return <SpacesList phone={phone} navigate={navigate} />;
  }
  if (spaceId !== null) {
    return <SpacePage key={spaceId} spaceId={spaceId} phone={phone} navigate={navigate} />;
  }
  if (bookId === null) {
    return <Library phone={phone} navigate={navigate} />;
  }
  return <Reader bookId={bookId} position={position} phone={phone} navigate={navigate} />;
}
