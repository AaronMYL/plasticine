// 首页「现在」里 等你 / 在做 以外的几块（2026-11-05 他定）各自从现有接口读：接着看（笔记、图书）、信息流头条。
// 「今天」读 /v2/calendar/today（第 15 条：他 Mac 上的 Apple 日历和提醒事项的缓存），同步完了服务端推 calendar.changed。
// 打开首页时读一次，相关的事件来了隔一小会儿再读；读不到那一块就不出现（原因写进控制台），各页自己照常报错。
// 笔记列表走笔记页的那份缓存（新鲜期里来回切不重读）。

import { useEffect, useState } from 'react';
import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { BookView, CalendarTodayView, FeedItemView, NoteMetaView } from '../../api/shared.ts';
import type { LiveEvent, NoteSearch } from '../../api/types.ts';
import { useApi } from '../../api/context.tsx';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { noteListKey } from '../../state/notes-cache.ts';
import { useStore } from '../../state/use-store.ts';

/** 事件来了等这么久再读：一串连着来的只读一次。 */
const RELOAD_DELAY_MS = 400;
/** 信息流头条几条（他定 3 条）。 */
export const FEED_HEADLINES = 3;

function useLoaded<T>(load: (api: PlasticineApi, signal: AbortSignal) => Promise<T>, key: string,
  events: ReadonlySet<LiveEvent['type']>, what: string): T | null {
  const api = useApi();
  const live = useLive();
  const [value, setValue] = useState<T | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    load(api, controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setValue(next);
      }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) {
        console.warn(`首页读不到${what}，这一块先不显示：${errorText(cause)}`);
      }
    });
    return () => controller.abort();
    // load 每次渲染都是新函数；读什么由 key 决定。
  }, [api, key, round]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = live.hub.on((event) => {
      if (event.type === 'resync' || events.has(event.type)) {
        if (timer !== null) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => setRound((value) => value + 1), RELOAD_DELAY_MS);
      }
    });
    return () => {
      stop();
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [live.hub, events]);
  return value;
}

const BOOK_EVENTS: ReadonlySet<LiveEvent['type']> = new Set(['book.changed']);
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
  return useLoaded(async (api, signal) => (await api.books.list(signal)).books, 'books', BOOK_EVENTS, '图书');
}

export function useFeedHeadlines(timeZone: string): FeedItemView[] | null {
  return useLoaded(async (api, signal) => (await api.feed.list({ tz: timeZone, limit: FEED_HEADLINES }, signal))
    .items.slice(0, FEED_HEADLINES), `feed:${timeZone}`, FEED_EVENTS, '信息流');
}

/** 今天的日程和提醒（读的时候服务端顺便叫 Mac 同步一次）；读不到是 null，这一块不出现。 */
export function useToday(timeZone: string): CalendarTodayView | null {
  return useLoaded((api, signal) => api.today.calendar({ tz: timeZone }, signal), `calendar:${timeZone}`,
    CALENDAR_EVENTS, '今天的日程');
}
