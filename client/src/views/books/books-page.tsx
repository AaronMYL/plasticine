// 资料库的主区（#/books、#/books/<id>[/<章>/<字>]、#/books/space[/<id>]）：没选书是图书馆，选了是阅读页；空间
// （第 6 条）是一份 Plasticine 写的报告，#/books/space 是空间的列表（手机「更多 · 空间」）。按路由懒加载。

import type { ReactNode } from 'react';
import type { BookRoutePosition, Route } from '../../shell/routes.ts';
import { Library } from './library.tsx';
import { Reader } from './reader.tsx';
import { SpacePage } from '../spaces/space-page.tsx';
import { SpacesList } from '../spaces/spaces-list.tsx';
import './books.css';
import './reader.css';
import './reader-popovers.css';
import './book-sheet.css';

export interface BooksPageProps {
  bookId: string | null;
  /** 资料库里的空间（#/books/space/<id>，第 6 条）。 */
  spaceId?: string | null;
  /** 空间的列表（#/books/space）。 */
  spacesList?: boolean;
  position: BookRoutePosition | null;
  phone: boolean;
  navigate: (route: Route) => void;
}

export function BooksPage({ bookId, spaceId = null, spacesList = false, position, phone, navigate }: BooksPageProps)
  : ReactNode {
  if (spacesList) {
    return <SpacesList navigate={navigate} />;
  }
  if (spaceId !== null) {
    return <SpacePage key={spaceId} spaceId={spaceId} phone={phone} navigate={navigate} />;
  }
  if (bookId === null) {
    return <Library phone={phone} navigate={navigate} />;
  }
  return <Reader bookId={bookId} position={position} phone={phone} navigate={navigate} />;
}
