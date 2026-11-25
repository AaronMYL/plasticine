import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { DEVICE_RESULT_SCHEMAS, type DeviceActionParams } from '../../shared/api/index.ts';
import type { DeviceNode } from '../../shared/state.ts';
import { nodeOnline, type ActionOutcome, type ActionRequest } from '../devices/index.ts';
import { dayRange, localDay } from '../daily/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { MAX_PAGE_SIZE, type StateService } from '../state/index.ts';

export const CALENDAR_SYNC_EVERY_MS = 10 * 60_000;
const SYNC_SLACK_MS = 60_000;
export const CALENDAR_KICK_GAP_MS = 60_000;
export const CALENDAR_SYNC_DAYS = 8;
const DAY_MS = 24 * 60 * 60_000;
const PURPOSE = '把今天和接下来 7 天的日程、没做完的提醒同步到首页和心跳';

export type CalendarSyncState = Pick<StateService, 'nodes' | 'calendarSnapshots'>;

export interface CalendarDevicePort {
  perform(request: ActionRequest): Promise<ActionOutcome>;
}

export interface CalendarSyncOptions {
  state: CalendarSyncState;
  devices: CalendarDevicePort;
  now: () => Date;
  zone: () => string;
  changed: () => void;
}

export function calendarMac(nodes: readonly DeviceNode[], now: Date): DeviceNode | null {
  const candidates = nodes.filter((node) => node.platform === 'macos' && node.revokedAt === null
    && (node.capabilities.includes('calendar_list') || node.capabilities.includes('reminder_list')));
  candidates.sort((left, right) => Number(nodeOnline(right, now)) - Number(nodeOnline(left, now))
    || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));
  return candidates[0] ?? null;
}

export function syncWindow(now: Date, zone: string): { from: string; to: string } {
  const from = dayRange(localDay(now, zone), zone).start;
  const last = localDay(new Date(now.getTime() + (CALENDAR_SYNC_DAYS - 1) * DAY_MS), zone);
  return { from: from.toISOString(), to: dayRange(last, zone).end.toISOString() };
}

export class CalendarSync {
  readonly #options: CalendarSyncOptions;
  #running: Promise<void> | null = null;
  #lastKick = 0;

  constructor(options: CalendarSyncOptions) {
    this.#options = options;
  }

  mac(): DeviceNode | null {
    const { state, now } = this.#options;
    return calendarMac(state.nodes.list({ limit: MAX_PAGE_SIZE }), now());
  }

  scan(): Promise<void> | null {
    const { state, now } = this.#options;
    const synced = [state.calendarSnapshots.latestEvents()?.syncedAt, state.calendarSnapshots.latestReminders()
      ?.syncedAt].filter((at): at is string => at !== undefined).map((at) => Date.parse(at));
    const oldest = synced.length === 0 ? 0 : Math.min(...synced);
    if (now().getTime() - oldest < CALENDAR_SYNC_EVERY_MS - SYNC_SLACK_MS) {
      return null;
    }
    return this.sync();
  }

  kick(force = false): void {
    const at = this.#options.now().getTime();
    if (!force && at - this.#lastKick < CALENDAR_KICK_GAP_MS) {
      return;
    }
    this.#lastKick = at;
    void this.sync();
  }

  sync(): Promise<void> {
    if (this.#running !== null) {
      return this.#running;
    }
    const mac = this.mac();
    if (mac === null || !nodeOnline(mac, this.#options.now())) {
      return Promise.resolve();
    }
    this.#running = this.#pull(mac).catch((error: unknown) => {
      safeLog('error', 'calendar_sync_failed', { objectId: mac.id, category: errorCategory(error) });
    }).finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #pull(mac: DeviceNode): Promise<void> {
    const { state, now, zone } = this.#options;
    const window = syncWindow(now(), zone());
    let saved = false;
    if (mac.capabilities.includes('calendar_list')) {
      const outcome = await this.#perform(mac, { kind: 'calendar_list', from: window.from, to: window.to });
      if (outcome !== null && Value.Check(DEVICE_RESULT_SCHEMAS.calendar_list, outcome)) {
        state.calendarSnapshots.saveEvents({ nodeId: mac.id, windowFrom: window.from, windowTo: window.to,
          items: outcome.events, syncedAt: now().toISOString() });
        saved = true;
      }
    }
    if (mac.capabilities.includes('reminder_list')) {
      const outcome = await this.#perform(mac, { kind: 'reminder_list', includeCompleted: false });
      if (outcome !== null && Value.Check(DEVICE_RESULT_SCHEMAS.reminder_list, outcome)) {
        state.calendarSnapshots.saveReminders({ nodeId: mac.id, windowFrom: window.from, windowTo: window.to,
          items: outcome.reminders, syncedAt: now().toISOString() });
        saved = true;
      }
    }
    if (saved) {
      this.#options.changed();
    }
  }

  async #perform(mac: DeviceNode, action: DeviceActionParams): Promise<unknown> {
    const outcome = await this.#options.devices.perform({ actionId: `calendar-sync:${action.kind}:${randomUUID()}`,
      nodeId: mac.id, action, origin: 'system', taskId: null, runId: null, purpose: PURPOSE });
    if (outcome.status !== 'executed') {
      safeLog('warn', 'calendar_sync_skipped', { objectId: outcome.actionId });
      return null;
    }
    return outcome.result;
  }
}
