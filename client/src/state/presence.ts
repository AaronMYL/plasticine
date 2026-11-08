// 这台设备上 App 在不在前台（2026-11-05 他定，首页第 7 条）：离开按 App 是否在前台算——网页不可见（切走、最小化、
// 锁屏）或窗口失焦都算离开，开着没碰不算；客户端记上一次在前台的时间，存 localStorage（按设备）。
// 离开 ≥ 1 小时再回来，记下这一段离开（since → until），首页顶上据此插一行「离开时：…」；那一行露过一次之后，
// 下次回到前台（到再离开 1 小时以上之前）不再出现。

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

export const PRESENCE_STORAGE_KEY = 'plasticine:presence';
/** 离开多久才算「离开过」：他定 1 小时。 */
export const AWAY_MIN_MS = 60 * 60 * 1000;
/** 在前台时隔多久记一次「还在」：关窗、崩溃时最多差这么多。 */
export const PRESENCE_BEAT_MS = 30_000;

const AwaySchema = Type.Object({ since: Type.String(), until: Type.String() });
const StoredSchema = Type.Object({
  lastVisibleAt: Type.Union([Type.String(), Type.Null()]),
  away: Type.Union([AwaySchema, Type.Null()]),
  /** 「离开时」那一行第一次露出来的时间；null = 还没露过。 */
  seenAt: Type.Union([Type.String(), Type.Null()]),
});
type Stored = Static<typeof StoredSchema>;
export type AwaySpan = Static<typeof AwaySchema>;

export interface PresenceView {
  /** 这一次回到前台之前的那段离开（≥ 1 小时）；这一次该不该插那一行看 show。 */
  away: AwaySpan | null;
  /** 首页顶上插不插「离开时」那一行。 */
  show: boolean;
}

const EMPTY: Stored = { lastVisibleAt: null, away: null, seenAt: null };

function readStored(storage: KeyValueStorage | null): Stored {
  const raw = storage?.getItem(PRESENCE_STORAGE_KEY) ?? null;
  if (raw === null) {
    return EMPTY;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Value.Check(StoredSchema, parsed) ? parsed : EMPTY;
  } catch (cause) {
    console.warn('前台记录读不出来，当没有', cause);
    return EMPTY;
  }
}

export class PresenceTracker {
  readonly view: Store<PresenceView>;
  private readonly storage: KeyValueStorage | null;
  private readonly now: () => Date;
  private stored: Stored;
  /** 这一次回到前台的时间：「露过」要早于它才算上一次露的。 */
  private sessionStartedAt: string | null = null;
  private foreground = false;

  constructor(storage: KeyValueStorage | null, now: () => Date = () => new Date()) {
    this.storage = storage;
    this.now = now;
    this.stored = readStored(storage);
    this.view = new Store<PresenceView>({ away: null, show: false });
  }

  /** 回到前台（打开、切回来、窗口拿到焦点）：离开够久就记下这一段。 */
  visible(): void {
    if (this.foreground) {
      return;
    }
    this.foreground = true;
    const at = this.now();
    const last = this.stored.lastVisibleAt;
    const gap = last === null ? 0 : at.getTime() - Date.parse(last);
    if (last !== null && gap >= AWAY_MIN_MS) {
      this.stored = { ...this.stored, away: { since: last, until: at.toISOString() }, seenAt: null };
    }
    this.sessionStartedAt = at.toISOString();
    this.save({ ...this.stored, lastVisibleAt: at.toISOString() });
  }

  /** 离开前台（切走、失焦、关窗前）：最后记一次在前台的时间。 */
  hidden(): void {
    if (!this.foreground) {
      return;
    }
    this.foreground = false;
    this.save({ ...this.stored, lastVisibleAt: this.now().toISOString() });
  }

  /** 在前台时每隔一会儿记一次（关窗、崩溃没来得及记 hidden）。 */
  beat(): void {
    if (this.foreground) {
      this.save({ ...this.stored, lastVisibleAt: this.now().toISOString() });
    }
  }

  /** 首页把那一行露出来了：这一次回到前台照常显示，之后到下一次离开不再出现。 */
  markSeen(): void {
    if (this.stored.away === null || this.stored.seenAt !== null) {
      return;
    }
    this.save({ ...this.stored, seenAt: this.now().toISOString() });
  }

  private save(next: Stored): void {
    this.stored = next;
    try {
      this.storage?.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(next));
    } catch (cause) {
      console.warn('前台记录存不下，这一次只记在内存里', cause);
    }
    const { away, seenAt } = next;
    const started = this.sessionStartedAt;
    const show = away !== null && (seenAt === null || (started !== null && seenAt >= started));
    const current = this.view.get();
    if (current.away !== away || current.show !== show) {
      this.view.set({ away, show });
    }
  }
}
