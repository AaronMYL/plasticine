// 资料库的主区（#/library、#/library/sub/<订阅>、#/library/trash，2026-11-08）：首页是空间列表，订阅页是一个订阅的
// 页头和往期，「最近删除」是删掉的空间、图书、文件。按路由懒加载（current-view.tsx）。

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
