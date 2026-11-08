// 首页「现在」的几块（2026-11-05 设计稿 Home；11-07 设计稿 Main 把「今天」挪到「在做」下面）：今天（他 Mac 上的
// Apple 日历和提醒事项，第 15 条）、接着看（笔记 / 书 / 网页，一排最多 6 个格子）、信息流头条 3 条（只在电脑上）。
// 块之间只靠间距和小节标题区分，没有卡片堆、没有说明字；哪一块是空的就整块不出现。

import type { CSSProperties, ReactNode } from 'react';
import type { FeedItemView, TodayEvent, TodayReminder } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { AiMark, StatusGlyph } from '../../shell/glyph.tsx';
import { HueTile, hueVar, type HueName } from '../../shell/hue.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import { useTabActions } from '../../shell/tabs-context.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { SourceMark, sourceOf } from '../feed/feed-card.tsx';
import { isAiNote } from '../notes/ai-folder.ts';
import { continueItems, type ContinueItem } from './continue-items.ts';
import { calendarHue, eventMeta, eventTime, reminderTime, staleNote } from './today-items.ts';
import { useBooks, useFeedHeadlines, useRecentNotes, useToday } from './use-home-sections.ts';
import '../feed/feed.css';

const CONTINUE_LOOK: Readonly<Record<ContinueItem['kind'], { hue: HueName; icon: IconName }>> = {
  note: { hue: 'teal', icon: 'notes' },
  book: { hue: 'ochre', icon: 'books' },
  web: { hue: 'ink', icon: 'globe' },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (cause) {
    console.warn('网页地址解不开，按原样显示', cause);
    return url;
  }
}

/** 格子下面那一小行：书写读到哪，网页写站点，笔记写什么时候改的。 */
function metaOf(item: ContinueItem, now: Date): string | null {
  if (item.kind === 'book') {
    return `${Math.round(item.percent * 100)}%`;
  }
  if (item.kind === 'web') {
    return hostOf(item.url);
  }
  return item.at === null ? null : relativeTime(item.at, now);
}

export function ContinueBlock({ now }: { now: Date }): ReactNode {
  const tabs = useTabActions();
  const { webTabs } = useClientState();
  const webState = useStore(webTabs.store);
  const notes = useRecentNotes();
  const books = useBooks();
  const items = continueItems({ notes: notes ?? [], books: books ?? [], tabs: webState.tabs,
    closed: webState.archived });
  if (items.length === 0) {
    return null;
  }
  const aiNotes = new Set((notes ?? []).filter(isAiNote).map((note) => note.id));
  const open = (item: ContinueItem): void => {
    if (item.kind === 'note') {
      tabs.openTab({ view: 'notes', noteId: item.id }, item.title);
    } else if (item.kind === 'book') {
      tabs.openTab({ view: 'books', noteId: null, bookId: item.id }, item.title);
    } else {
      tabs.openWeb(item.url, item.title);
    }
  };
  return (
    <section className="home-section" aria-label="接着看">
      <h2 className="home-section-title">接着看</h2>
      <ul className="home-continue">
        {items.map((item) => {
          const look = CONTINUE_LOOK[item.kind];
          const meta = metaOf(item, now);
          const ai = item.kind === 'note' && aiNotes.has(item.id);
          return (
            <li key={item.key}>
              <button type="button" className="home-continue-item" onClick={() => open(item)}>
                <HueTile hue={look.hue} icon={look.icon} size={24} />
                <span className="home-continue-title">{item.title}</span>
                {meta === null ? null : (
                  <span className="home-continue-meta">{ai ? <AiMark /> : null}{meta}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EventRow({ event, timeZone, phone, now }: { event: TodayEvent; timeZone: string; phone: boolean;
  now: Date }): ReactNode {
  const meta = phone ? null : eventMeta(event, now);
  const hue = calendarHue(event.color);
  return (
    <li className="home-row-line home-today-row">
      <span className="home-today-time">{eventTime(event, timeZone, phone)}</span>
      <span className="home-today-lead">
        <span className="home-today-dot" role="img" aria-label={event.calendar} data-tip={event.calendar}
          style={{ '--dot-hue': hueVar(hue) } as CSSProperties} />
      </span>
      <span className="home-today-title">{event.title}</span>
      {meta === null ? null : <span className="home-today-meta">{meta}</span>}
    </li>
  );
}

function ReminderRow({ reminder, timeZone, phone }: { reminder: TodayReminder; timeZone: string;
  phone: boolean }): ReactNode {
  return (
    <li className="home-row-line home-today-row">
      <span className="home-today-time">{reminderTime(reminder.due, reminder.hasTime, timeZone)}</span>
      <span className="home-today-lead"><StatusGlyph status="idle" label="没做完的提醒" /></span>
      <span className="home-today-title">{reminder.title}</span>
      {phone ? null : <span className="home-today-meta">{reminder.list}</span>}
    </li>
  );
}

/** 今天：日程在前（时间、日历颜色点、标题、还有多久），提醒在后（空心圈、标题、所在列表）。没有就整块不出现。 */
export function TodayBlock({ now, phone }: { now: Date; phone: boolean }): ReactNode {
  const timeZone = useTimeZone();
  const today = useToday(timeZone);
  if (today === null || today.events.length + today.reminderItems.length === 0) {
    return null;
  }
  const stale = staleNote(today.syncedAt, now, timeZone);
  return (
    <section className="home-section" aria-label="今天" data-device={phone ? 'phone' : 'desktop'}>
      <h2 className="home-section-title">
        今天{stale === null ? null : <span className="home-today-synced">{stale}</span>}
      </h2>
      <ul className="home-list">
        {today.events.map((event) => (
          <EventRow key={event.key} event={event} timeZone={timeZone} phone={phone} now={now} />
        ))}
        {today.reminderItems.map((reminder) => (
          <ReminderRow key={reminder.key} reminder={reminder} timeZone={timeZone} phone={phone} />
        ))}
      </ul>
    </section>
  );
}

function openFeedItem(item: FeedItemView, tabs: ReturnType<typeof useTabActions>): void {
  if (item.url !== null) {
    tabs.openWeb(item.url, item.title || item.sourceLabel);
    return;
  }
  tabs.openTab({ view: 'feed', noteId: null, feedItemId: item.id }, item.title);
}

export function FeedBlock({ items, now }: { items: readonly FeedItemView[]; now: Date }): ReactNode {
  const tabs = useTabActions();
  return (
    <section className="home-section" aria-label="信息流">
      <h2 className="home-section-title">
        <button type="button" className="home-section-link" onClick={() => tabs.focusSection('feed')}>
          信息流<Icon name="chevron-right" size={14} />
        </button>
      </h2>
      <ul className="home-list">
        {items.map((item) => {
          const title = item.title.trim() === '' ? item.summary : item.title;
          return (
            <li key={item.id}>
              <button type="button" className="home-row-line home-feed-row" onClick={() => openFeedItem(item, tabs)}>
                <SourceMark source={sourceOf(item)} />
                <span className="home-feed-title">{title}</span>
                <span className="home-feed-time">{relativeTime(item.arrivedAt, now)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 信息流头条：只在电脑上（手机的信息流在底栏）。 */
export function FeedHeadlines({ now, phone }: { now: Date; phone: boolean }): ReactNode {
  const timeZone = useTimeZone();
  const feed = useFeedHeadlines(timeZone);
  if (phone || feed === null || feed.length === 0) {
    return null;
  }
  return <FeedBlock items={feed} now={now} />;
}
