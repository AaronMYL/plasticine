// 「定时」那一栏和「队友」（《优化清单》第 3、5 条）：所有到点自己跑的事一行一个——定时线（本模块）、订阅、回顾、做梦、
// 心跳（各自的模块登记进来）。每行写清做什么、下次什么时候跑、上次结果，能暂停、能删；每件长期的事有一个看得见的
// 执行者（队友）：名字、正在做什么、上次做了什么，可以叫停。
// 登记接口是 TimedProvider：给出自己的行和队友，管自己的开关、删除、叫停；这里只汇总、按 id 派回去。

import type { TeammateView, TimedRowView, TimedSource } from '../../shared/api/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { ScheduleError } from './schedules.ts';

export interface TimedProvider {
  source: TimedSource;
  rows(): TimedRowView[];
  /** 不给就按行推：同一个 teammateId 的几行是同一位。 */
  teammates?(): TeammateView[];
  setEnabled(rowId: string, on: boolean): void;
  /** 不能删的（心跳、做梦只能关）不给。 */
  remove?(rowId: string): void;
  /** 叫停这位队友：停掉它管的每一行，正在跑的那一轮也停。不给就是逐行关掉。 */
  stop?(teammateId: string): void;
  /** 每分钟看一眼（tasks 的计时器，和定时线同一个）：到点的自己去做。 */
  tick?(now: Date): void;
  /** 一条线这一轮停下（lines/ 的 turnEnded）：是自己的线就记上次结果。 */
  ended?(lineId: string): void;
}

export interface TeammateLook {
  name: string;
  /** 正在跑时那一步（线上的 activity）；不在跑是 null。 */
  activity: string | null;
  lineId: string | null;
}

/** 按行推队友：在跑 > 等你 > 出错 > 没开始 > 暂停；「在做什么」是在跑的那一步，不然是上次结果。 */
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
    const glyph = running !== undefined ? 'run' : glyphs.includes('wait') ? 'wait' : glyphs.includes('err') ? 'err'
      : members.every((row) => !row.enabled) ? 'pause' : 'idle';
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

  /** 别的模块（订阅、回顾、做梦、心跳）把自己登记进来。同一种来源只登记一次。 */
  register(provider: TimedProvider): void {
    if (this.#providers.some((item) => item.source === provider.source)) {
      throw new Error(`定时来源「${provider.source}」登记过了`);
    }
    this.#providers.push(provider);
  }

  rows(): TimedRowView[] {
    return this.#providers.flatMap((provider) => provider.rows());
  }

  /** 每分钟一次：各来源看自己到没到点。一家出错只记日志，不拦别家。 */
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
