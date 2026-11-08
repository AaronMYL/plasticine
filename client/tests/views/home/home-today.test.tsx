// 首页「今天」（第 15 条，设计稿 Main / Phone-Now）：日程是时间、日历颜色点、标题、还有多久；提醒是空心圈、标题、
// 所在列表；没连 Mac、没给权限（服务端不给那一块）整块不出；缓存超过 1 小时才写几点同步的；同步完重读。

import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarTodayView } from '../../../src/api/shared.ts';
import { calendarHue, eventMeta, eventTime, staleNote } from '../../../src/views/home/today-items.ts';
import { NOW, renderApp } from '../../helpers.tsx';

const ZONE = 'Asia/Shanghai';
// 首页按真实的现在算「还有多久」，所以这一节的日程跟着真实时钟摆；小字的单测按固定的 NOW。
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

describe('首页「今天」的小字', () => {
  it('正在开的写还剩多久，两小时内开始的写几分钟后，再远的不写', () => {
    const [ongoing, later] = view().events;
    expect(eventMeta(ongoing!, NOW)).toBe('还有 48 分钟');
    expect(eventMeta(later!, NOW)).toBeNull();
    expect(eventMeta({ ...later!, start: at(90), end: at(120) }, NOW)).toBe('1 小时 30 分钟后');
    expect(eventMeta({ ...later!, allDay: true }, NOW)).toBeNull();
  });

  it('时间列：电脑写起止，手机只写开始，全天写全天', () => {
    const event = { ...view().events[0]!, start: '2026-11-08T06:00:00.000Z', end: '2026-11-08T07:00:00.000Z' };
    expect(eventTime(event, ZONE, false)).toBe('14:00–15:00');
    expect(eventTime(event, ZONE, true)).toBe('14:00');
    expect(eventTime({ ...event, allDay: true }, ZONE, false)).toBe('全天');
  });

  it('Apple 日历的颜色落到类别色上，灰的用中性色', () => {
    expect(calendarHue('#1BADF8')).toBe('sky');
    expect(calendarHue('#63DA38')).toBe('sage');
    expect(calendarHue('#FF2968')).toBe('rose');
    expect(calendarHue('#FFCC00')).toBe('ochre');
    expect(calendarHue('#FF9500')).toBe('clay');
    expect(calendarHue('#CC73E1')).toBe('slate');
    expect(calendarHue('#8E8E93')).toBe('ink');
    expect(calendarHue(null)).toBe('ink');
  });

  it('同步时间只在缓存超过 1 小时时出现，不是今天的带日期', () => {
    const now = new Date('2026-11-08T06:12:00.000Z');
    expect(staleNote('2026-11-08T05:30:00.000Z', now, ZONE)).toBeNull();
    expect(staleNote('2026-11-08T03:02:00.000Z', now, ZONE)).toBe('11:02 同步');
    expect(staleNote('2026-11-07T13:10:00.000Z', now, ZONE)).toBe('11/7 21:10 同步');
    expect(staleNote(null, now, ZONE)).toBeNull();
  });
});

describe('首页「今天」一节', () => {
  beforeEach(() => {
    base = Date.now();
  });

  afterEach(() => {
    base = NOW.getTime();
  });

  it('日程在前、提醒在后；颜色点读得出是哪个日历，提醒是空心圈', async () => {
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

  it('没连 Mac、或两块都没内容：整块不出现', async () => {
    await renderApp({ hash: '#/today', setup: ({ control }) => control.today.setCalendar(view({ calendar: false,
      reminders: false, events: [], reminderItems: [] })) });
    await screen.findByRole('heading', { level: 1 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('region', { name: '今天' })).toBeNull();
  });

  it('Mac 不在线、缓存旧了：标题旁写几点同步的', async () => {
    await renderApp({ hash: '#/today', setup: ({ control }) => control.today.setCalendar(view({ macOnline: false,
      syncedAt: at(-180) })) });
    const today = await screen.findByRole('region', { name: '今天' });
    expect(within(today).getByText(/同步$/)).toBeTruthy();
  });

  it('同步完（calendar.changed）重读', async () => {
    const app = await renderApp({ hash: '#/today', setup: ({ control }) => control.today.setCalendar(view()) });
    await screen.findByRole('region', { name: '今天' });
    app.control.today.setCalendar(view({ events: [], reminderItems: [{ kind: 'reminder', key: 'n', title: '取快递',
      due: at(30), hasTime: true, list: '提醒事项' }] }));
    act(() => app.control.bus.emit({ type: 'calendar.changed' }));
    await waitFor(() => expect(screen.getByText('取快递')).toBeTruthy());
    expect(screen.queryByText('产品周会')).toBeNull();
  });
});
