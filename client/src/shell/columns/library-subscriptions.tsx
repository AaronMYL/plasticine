import type { ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { LibraryTrashResponse, SubscriptionListItem } from '../../api/shared.ts';
import { useQuery } from '../../state/use-query.ts';
import type { LiveEvent } from '../../api/types.ts';
import { HueTile } from '../hue.tsx';
import { Icon } from '../icons.tsx';
import { RevealMore } from '../reveal-more.tsx';
import { useSubscriptionMenu } from '../../views/library/subscription-menu.tsx';
import { LIBRARY_TRASH, subscriptionRoute } from '../library-routes.ts';
import type { Route } from '../routes.ts';
import { ColumnCount, ColumnLabel, ColumnLink, ColumnNote } from './column.tsx';
import { subscriptionLook } from './space-look.ts';

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
  const menu = useSubscriptionMenu(false, navigate);
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
          <div key={item.id} className="column-row">
            <ColumnLink route={subscriptionRoute(item.id)} navigate={navigate}
              current={route.view === 'library' && route.subscriptionId === item.id}
              lead={<HueTile hue={look.hue} icon={look.icon} size={22} />}
              trail={<ColumnCount value={item.issueCount} label="期" />}>
              {item.title}
            </ColumnLink>
            <RevealMore label={`「${item.title}」的更多操作`} actions={menu.actions(item)} />
          </div>
        );
      })}
      {menu.dialogs}
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
