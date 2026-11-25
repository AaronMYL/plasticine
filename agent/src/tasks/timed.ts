import type { TeammateView, TimedRowView, TimedSource } from '../../shared/api/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { ScheduleError } from './schedules.ts';

export interface TimedProvider {
  source: TimedSource;
  rows(): TimedRowView[];
  teammates?(): TeammateView[];
  setEnabled(rowId: string, on: boolean): void;
  remove?(rowId: string): void;
  stop?(teammateId: string): void;
  tick?(now: Date): void;
  ended?(lineId: string): void;
}

export interface TeammateLook {
  name: string;
  activity: string | null;
  lineId: string | null;
}

export function teammatesFromRows(rows: readonly TimedRowView[], look: (row: TimedRowView) => TeammateLook)
  : TeammateView[] {
  const groups = new Map<string, TimedRowView[]>();
  for (const row of rows) {
    groups.set(row.teammateId, [...groups.get(row.teammateId) ?? [], row]);
  }
  return [...groups.entries()].map(([id, members]) => {
    const first = members[0]!;
    const looks = members.map(look);
    const running = looks.find((item) => item.activity !== null);
    const glyphs = members.map((row) => row.last?.glyph ?? 'idle');
    const resting = members.every((row) => !row.enabled) ? 'pause' : 'idle';
    const waiting = glyphs.includes('wait') ? 'wait' : glyphs.includes('err') ? 'err' : resting;
    const glyph = running !== undefined ? 'run' : waiting;
    const latest = members.find((row) => row.last !== null)?.last?.text;
    return {
      id,
      name: looks[0]!.name,
      icon: first.icon,
      hue: first.hue,
      glyph,
      now: running?.activity ?? latest ?? '',
      rowIds: members.map((row) => row.id),
      lineId: running?.lineId ?? looks.find((item) => item.lineId !== null)?.lineId ?? null,
      canStop: members.some((row) => row.enabled) || running !== undefined,
    };
  });
}

export class TimedRegistry {
  readonly #providers: TimedProvider[] = [];

  register(provider: TimedProvider): void {
    if (this.#providers.some((item) => item.source === provider.source)) {
      throw new Error(`定时来源「${provider.source}」登记过了`);
    }
    this.#providers.push(provider);
  }

  rows(): TimedRowView[] {
    return this.#providers.flatMap((provider) => provider.rows());
  }

  tick(now: Date): void {
    for (const provider of this.#providers) {
      try {
        provider.tick?.(now);
      } catch (error) {
        safeLog('error', 'timed_tick_failed', { objectId: provider.source, category: errorCategory(error), error });
      }
    }
  }

  ended(lineId: string): void {
    for (const provider of this.#providers) {
      try {
        provider.ended?.(lineId);
      } catch (error) {
        safeLog('error', 'timed_ended_failed', { objectId: provider.source, category: errorCategory(error), error });
      }
    }
  }

  teammates(): TeammateView[] {
    return this.#providers.flatMap((provider) => provider.teammates?.()
      ?? teammatesFromRows(provider.rows(), (row) => ({ name: row.title, activity: null, lineId: row.lineId })));
  }

  setEnabled(rowId: string, on: boolean): TimedRowView | null {
    const provider = this.#owner(rowId);
    provider.setEnabled(rowId, on);
    return provider.rows().find((row) => row.id === rowId) ?? null;
  }

  remove(rowId: string): void {
    const provider = this.#owner(rowId);
    if (provider.remove === undefined) {
      throw new ScheduleError('conflict', '这一项不能删，只能关掉。');
    }
    provider.remove(rowId);
  }

  stop(teammateId: string): TeammateView | null {
    for (const provider of this.#providers) {
      const mates = provider.teammates?.() ?? teammatesFromRows(provider.rows(),
        (row) => ({ name: row.title, activity: null, lineId: row.lineId }));
      const mate = mates.find((item) => item.id === teammateId);
      if (mate === undefined) {
        continue;
      }
      if (provider.stop !== undefined) {
        provider.stop(teammateId);
      } else {
        for (const rowId of mate.rowIds) {
          provider.setEnabled(rowId, false);
        }
      }
      return this.teammates().find((item) => item.id === teammateId) ?? null;
    }
    throw new ScheduleError('not_found', '没有这位队友。');
  }

  #owner(rowId: string): TimedProvider {
    const provider = this.#providers.find((item) => item.rows().some((row) => row.id === rowId));
    if (provider === undefined) {
      throw new ScheduleError('not_found', '定时列表里没有这一项。');
    }
    return provider;
  }
}
