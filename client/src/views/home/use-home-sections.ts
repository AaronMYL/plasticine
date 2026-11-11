// 首页「现在」里 等你 / 在做 以外的几块（2026-11-05 他定）各自从现有接口读：接着看（笔记、图书）、信息流头条。
// 「今天」读 /v2/calendar/today（第 15 条：他 Mac 上的 Apple 日历和提醒事项的缓存），同步完了服务端推 calendar.changed。
// 走共用缓存（state/live-query.ts）：切回首页先画上次的，相关的事件来了隔一小会儿再读；读不到那一块就不出现（原因写进控制台），各页自己照常报错。
// 笔记列表走笔记页的那份缓存（新鲜期里来回切不重读）。

import { useEffect } from 'react';
import type { PlasticineApi } from '../../api/client.ts';
import type { BookView, CalendarTodayView, FeedItemView, NoteMetaView } from '../../api/shared.ts';
import type { LiveEvent, NoteSearch } from '../../api/types.ts';
import { useApi } from '../../api/context.tsx';
import { useClientState } from '../../state/context.tsx';
import { noteListKey } from '../../state/notes-cache.ts';
import { useStore } from '../../state/use-store.ts';
import { useQuery } from '../../state/use-query.ts';
import { useBooksList } from '../books/use-books-list.ts';

/** 信息流头条几条（他定 3 条）。 */
export const FEED_HEADLINES = 3;

/** 首页的一块：走共用缓存（切回首页直接画上次的，后台再对一遍）；读不到这一块就不出现，原因写进控制台。 */
function useSection<T>(key: string, load: (api: PlasticineApi, signal: AbortSignal) => Promise<T>,
  events: ReadonlySet<LiveEvent['type']>, what: string): T | null {
  const api = useApi();
  const query = useQuery(key, (signal) => load(api, signal), events);
  useEffect(() => {
    if (query.error !== null) {
      console.warn(`首页读不到${what}，这一块先不显示：${query.error}`);
    }
  }, [query.error, what]);
  return query.data;
}

const FEED_EVENTS: ReadonlySet<LiveEvent['type']> = new Set(['feed.changed']);
const CALENDAR_EVENTS: ReadonlySet<LiveEvent['type']> = new Set(['calendar.changed']);

/** 全部笔记的查询：和笔记页同一份缓存（notes-cache.ts），首页和笔记页来回切不重复读列表。 */
const ALL_NOTES: NoteSearch = { q: '' };

export function useRecentNotes(): NoteMetaView[] | null {
  const api = useApi();
  const { notesCache } = useClientState();
  const lists = useStore(notesCache.lists);
  useEffect(() => notesCache.observeList(api.notes, ALL_NOTES), [api, notesCache]);
  return lists.get(noteListKey(ALL_NOTES))?.notes ?? null;
}

export function useBooks(): BookView[] | null {
  return useBooksList().books;
}

export function useFeedHeadlines(timeZone: string): FeedItemView[] | null {
  return useSection(`home.feed:${timeZone}`, async (api, signal) => (await api.feed.list({ tz: timeZone,
    limit: FEED_HEADLINES }, signal)).items.slice(0, FEED_HEADLINES), FEED_EVENTS, '信息流');
}

/** 今天的日程和提醒（读的时候服务端顺便叫 Mac 同步一次）；读不到是 null，这一块不出现。 */
export function useToday(timeZone: string): CalendarTodayView | null {
  return useSection(`home.calendar:${timeZone}`, (api, signal) => api.today.calendar({ tz: timeZone }, signal),
    CALENDAR_EVENTS, '今天的日程');
}
