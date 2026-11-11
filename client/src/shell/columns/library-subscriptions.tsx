// 资料库第二栏顶上的「订阅」一组（2026-11-08 他定：订阅从信息流挪到资料库，按订阅分组；设计稿 Library-Subscription）：
// 每个订阅一行（个人回顾、各个研究周报），行尾是往期数量；点进去是订阅页 #/library/sub/<id>。还只是草案、一期没出的不列。
// 「最近删除」那一行贴在第二栏底部。

import type { ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { LibraryTrashResponse, SubscriptionListItem } from '../../api/shared.ts';
import { useQuery } from '../../state/use-query.ts';
import type { LiveEvent } from '../../api/types.ts';
import { HueTile } from '../hue.tsx';
import { Icon } from '../icons.tsx';
import { LIBRARY_TRASH, subscriptionRoute } from '../library-routes.ts';
import type { Route } from '../routes.ts';
import { ColumnCount, ColumnLabel, ColumnLink, ColumnNote } from './column.tsx';
import { subscriptionLook } from './space-look.ts';

/** 资料库里列哪些订阅：出过一期的，或者已经开过定时的。 */
export function listedSubscriptions(items: readonly SubscriptionListItem[]): SubscriptionListItem[] {
  return items.filter((item) => item.issueCount > 0 || item.status !== 'draft');
}

const BOOK_EVENTS: ReadonlySet<LiveEvent['type']> = new Set(['book.changed']);

export function useSubscriptionList(): { subscriptions: SubscriptionListItem[] | null; error: string | null } {
  const api = useApi();
  const query = useQuery('subscriptions.list', (signal) => api.subscriptions.list(signal), BOOK_EVENTS);
  return { subscriptions: query.data === null ? null : listedSubscriptions(query.data.subscriptions),
    error: query.error };
}

export function useLibraryTrash(): { trash: LibraryTrashResponse | null; error: string | null } {
  const api = useApi();
  const query = useQuery('library.trash', (signal) => api.library.trash(signal), BOOK_EVENTS);
  return { trash: query.data, error: query.error };
}

export function SubscriptionRows({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const { subscriptions, error } = useSubscriptionList();
  if (error !== null) {
    return <ColumnNote>{error}</ColumnNote>;
  }
  if (subscriptions === null || subscriptions.length === 0) {
    return null;
  }
  return (
    <>
      <ColumnLabel>订阅</ColumnLabel>
      {subscriptions.map((item) => {
        const look = subscriptionLook(item.kind);
        return (
          <ColumnLink key={item.id} route={subscriptionRoute(item.id)} navigate={navigate}
            current={route.view === 'library' && route.subscriptionId === item.id}
            lead={<HueTile hue={look.hue} icon={look.icon} size={22} />}
            trail={<ColumnCount value={item.issueCount} label="期" />}>
            {item.title}
          </ColumnLink>
        );
      })}
    </>
  );
}

export function TrashRow({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const { trash } = useLibraryTrash();
  return (
    <ColumnLink route={LIBRARY_TRASH} navigate={navigate} current={route.view === 'library'
      && route.libraryTrash === true} lead={<Icon name="trash" size={16} />}
      trail={<ColumnCount value={trash?.items.length ?? null} label="项" />}>
      最近删除
    </ColumnLink>
  );
}
