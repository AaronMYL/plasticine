import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarTodayView } from '../../../src/api/shared.ts';
import { calendarHue, eventMeta, eventTime, staleNote } from '../../../src/views/home/today-items.ts';
import { NOW, renderApp } from '../../helpers.tsx';

const ZONE = 'Asia/Shanghai';
let base = NOW.getTime();
const at = (minutes: number): string => new Date(base + minutes * 60_000).toISOString();

function view(overrides: Partial<CalendarTodayView> = {}): CalendarTodayView {
  return { calendar: true, reminders: true, macOnline: true, syncedAt: at(-2),
    events: [
      { kind: 'event', key: 'a', title: '产品周会', start: at(-12), end: at(48), allDay: false, color: '#1BADF8',
        calendar: '工作' },
      { kind: 'event', key: 'b', title: '健身', start: at(318), end: at(378), allDay: false, color: '#63DA38',
        calendar: '生活' },
    ],
    reminderItems: [{ kind: 'reminder', key: 'r', title: '交房租', due: at(-600), hasTime: false, list: '提醒事项' }],
    ...overrides };
}

describe('Home: Today subtext', () => {
  it('shows remaining time for ongoing events, countdown within 2 hours, blank further out', () => {
    const [ongoing, later] = view().events;
    expect(eventMeta(ongoing!, NOW)).toBe('还有 48 分钟');
    expect(eventMeta(later!, NOW)).toBeNull();
    expect(eventMeta({ ...later!, start: at(90), end: at(120) }, NOW)).toBe('1 小时 30 分钟后');
    expect(eventMeta({ ...later!, allDay: true }, NOW)).toBeNull();
  });

  it('time column shows start-end on desktop, start only on mobile, and All Day for all-day', () => {
    const event = { ...view().events[0]!, start: '2026-11-08T06:00:00.000Z', end: '2026-11-08T07:00:00.000Z' };
    expect(eventTime(event, ZONE, false)).toBe('14:00–15:00');
    expect(eventTime(event, ZONE, true)).toBe('14:00');
    expect(eventTime({ ...event, allDay: true }, ZONE, false)).toBe('全天');
  });

  it('maps Apple Calendar colors to category tokens and gray to neutral', () => {
    expect(calendarHue('#1BADF8')).toBe('sky');
    expect(calendarHue('#63DA38')).toBe('sage');
    expect(calendarHue('#FF2968')).toBe('rose');
    expect(calendarHue('#FFCC00')).toBe('ochre');
    expect(calendarHue('#FF9500')).toBe('clay');
    expect(calendarHue('#CC73E1')).toBe('slate');
    expect(calendarHue('#8E8E93')).toBe('ink');
    expect(calendarHue(null)).toBe('ink');
  });

  it('shows sync time only when cache is >1 hour old, adding date if not today', () => {
    const now = new Date('2026-11-08T06:12:00.000Z');
    expect(staleNote('2026-11-08T05:30:00.000Z', now, ZONE)).toBeNull();
    expect(staleNote('2026-11-08T03:02:00.000Z', now, ZONE)).toBe('11:02 同步');
    expect(staleNote('2026-11-07T13:10:00.000Z', now, ZONE)).toBe('11/7 21:10 同步');
    expect(staleNote(null, now, ZONE)).toBeNull();
  });
});

describe('Home: Today section', () => {
  beforeEach(() => {
    base = Date.now();
  });

  afterEach(() => {
    base = NOW.getTime();
  });

  it('lists events before reminders with accessible calendar color dots and hollow circles', async () => {
    await renderApp({ hash: '#/today', setup: ({ control }) => control.today.setCalendar(view()) });
    const today = await screen.findByRole('region', { name: '今天' });
    const rows = within(today).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/产品周会还有 4[78] 分钟$/), expect.stringContaining('健身'),
      expect.stringContaining('交房租提醒事项')]);
    expect(within(rows[0]!).getByRole('img', { name: '工作' })).toBeTruthy();
    expect(within(rows[2]!).getByRole('img', { name: '没做完的提醒' })).toBeTruthy();
    expect(within(today).queryByText(/同步/)).toBeNull();
  });

  it('hides entire section when Mac is disconnected or both lists are empty', async () => {
    await renderApp({ hash: '#/today', setup: ({ control }) => control.today.setCalendar(view({ calendar: false,
      reminders: false, events: [], reminderItems: [] })) });
    await screen.findByRole('heading', { level: 1 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('region', { name: '今天' })).toBeNull();
  });

  it('shows sync timestamp next to heading when Mac is offline with stale cache', async () => {
    await renderApp({ hash: '#/today', setup: ({ control }) => control.today.setCalendar(view({ macOnline: false,
      syncedAt: at(-180) })) });
    const today = await screen.findByRole('region', { name: '今天' });
    expect(within(today).getByText(/同步$/)).toBeTruthy();
  });

  it('reloads when calendar.changed event arrives after sync', async () => {
    const app = await renderApp({ hash: '#/today', setup: ({ control }) => control.today.setCalendar(view()) });
    await screen.findByRole('region', { name: '今天' });
    app.control.today.setCalendar(view({ events: [], reminderItems: [{ kind: 'reminder', key: 'n', title: '取快递',
      due: at(30), hasTime: true, list: '提醒事项' }] }));
    act(() => app.control.bus.emit({ type: 'calendar.changed' }));
    await waitFor(() => expect(screen.getByText('取快递')).toBeTruthy());
    expect(screen.queryByText('产品周会')).toBeNull();
  });
});
