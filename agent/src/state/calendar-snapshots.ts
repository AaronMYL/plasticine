// Apple 日历和提醒事项的缓存（《优化清单》第 15 条）：每台 Mac 每种（日程 / 提醒）一行，新同步的一份整份换掉旧的
// （ON CONFLICT 更新，不删行）。读的时候取最近同步的那台；存进去和读出来都过 schema，坏数据不进不出。

import {
  CalendarEventsSnapshotSchema,
  CalendarRemindersSnapshotSchema,
  type CalendarEventsSnapshot,
  type CalendarRemindersSnapshot,
  type CalendarSnapshotScope,
} from '../../shared/state.ts';
import { checked } from './codec.ts';
import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

type SnapshotInput<T> = Omit<T, 'scope'>;

function rowOf(row: Row | undefined): Record<string, unknown> | undefined {
  if (row === undefined) {
    return undefined;
  }
  return { nodeId: String(row['node_id']), scope: String(row['scope']), windowFrom: String(row['window_from']),
    windowTo: String(row['window_to']), items: JSON.parse(String(row['items'])) as unknown,
    syncedAt: String(row['synced_at']) };
}

export function createCalendarSnapshotStore(context: StoreContext) {
  const save = (scope: CalendarSnapshotScope, snapshot: SnapshotInput<CalendarEventsSnapshot>
    | SnapshotInput<CalendarRemindersSnapshot>): void => {
    context.db.run(`INSERT INTO calendar_snapshots (node_id, scope, window_from, window_to, items, synced_at)
      VALUES ($node, $scope, $from, $to, $items, $at)
      ON CONFLICT (node_id, scope) DO UPDATE SET window_from = $from, window_to = $to, items = $items, synced_at = $at`,
    { node: snapshot.nodeId, scope, from: snapshot.windowFrom, to: snapshot.windowTo,
      items: JSON.stringify(snapshot.items), at: snapshot.syncedAt });
  };
  const latest = (scope: CalendarSnapshotScope): Record<string, unknown> | undefined => rowOf(context.db.get(
    'SELECT * FROM calendar_snapshots WHERE scope = $scope ORDER BY synced_at DESC, node_id LIMIT 1', { scope }));
  return {
    saveEvents(snapshot: SnapshotInput<CalendarEventsSnapshot>): void {
      save('events', checked(CalendarEventsSnapshotSchema, { ...snapshot, scope: 'events' }, 'invalid_input',
        '日程缓存'));
    },
    saveReminders(snapshot: SnapshotInput<CalendarRemindersSnapshot>): void {
      save('reminders', checked(CalendarRemindersSnapshotSchema, { ...snapshot, scope: 'reminders' },
        'invalid_input', '提醒缓存'));
    },
    /** 最近同步的那份日程；还没同步过是 undefined。 */
    latestEvents(): CalendarEventsSnapshot | undefined {
      const row = latest('events');
      return row === undefined ? undefined : checked(CalendarEventsSnapshotSchema, row, 'corrupt_record', '日程缓存');
    },
    latestReminders(): CalendarRemindersSnapshot | undefined {
      const row = latest('reminders');
      return row === undefined ? undefined : checked(CalendarRemindersSnapshotSchema, row, 'corrupt_record', '提醒缓存');
    },
  };
}

export type CalendarSnapshotStore = ReturnType<typeof createCalendarSnapshotStore>;
