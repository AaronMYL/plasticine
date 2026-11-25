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

export const FEED_HEADLINES = 3;

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

export function useToday(timeZone: string): CalendarTodayView | null {
  return useSection(`home.calendar:${timeZone}`, (api, signal) => api.today.calendar({ tz: timeZone }, signal),
    CALENDAR_EVENTS, '今天的日程');
}
