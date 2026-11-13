// 「做梦」定时（《优化清单》第 10 条夜里那一半，11-06 定）：每晚凌晨 1 点（他所在地的时区）整理一次记忆，列在「任务 ·
// 定时」，花名册里也有它；只能关，不能删。当天没有新对话就跳过；某晚失败了，下一晚从上次整理到的地方接着读，把那段补上。
// 和后台线共用并发上限 3：后台线满着就等十分钟再看。整理本身在 brain/ 的 Dreamer（用途 dream 的便宜模型）。

import type { TeammateView, TimedRowView } from '../../shared/api/index.ts';
import { STANDING_PROJECT_IDS, type ScheduleCadence, type TimedSlot } from '../../shared/state.ts';
import type { Dreamer } from '../brain/index.ts';
import { localDay } from '../daily/index.ts';
import { MAX_BACKGROUND_LINES } from '../lines/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import type { StateService } from '../state/index.ts';
import { nextRun, rezonedNext, slotLast, type TimedProvider } from '../tasks/index.ts';

export const DREAM_SLOT_ID = 'dream';
/** 每晚凌晨 1 点（11-06 定）。 */
export const DREAM_CADENCE: ScheduleCadence = { type: 'daily', at: '01:00' };
const DAY_MS = 24 * 60 * 60 * 1000;
/** 后台线满着：等十分钟再看一眼。 */
const BUSY_RETRY_MS = 10 * 60 * 1000;
/** 一晚最长等模型这么久（三轮，每轮 3 分钟上限在 askJson 里）。 */
const NIGHT_TIMEOUT_MS = 15 * 60 * 1000;

export type NightState = Pick<StateService, 'timedSlots' | 'lines'>;

export interface DreamNightOptions {
  state: NightState;
  /** 没有模型（测试、还没连模型）是 null：到点记一句原因，下一晚再试。 */
  dreamer: () => Dreamer | null;
  now: () => Date;
  zone: () => string;
  changed?: (docIds: readonly string[]) => void;
  /** 后台线同时跑几条（设置里可调）；不给按默认。 */
  limit?: () => number;
  /**
   * 预测闭环（11-13）：整理完记忆再写一份「我自己的说明书」（loop/self-notes.ts）。回 true 写了、false 没新结果；
   * 失败只记日志，不算这一晚没整理成。
   */
  selfNotes?: (now: Date, signal: AbortSignal) => Promise<boolean>;
}

function memoText(slot: TimedSlot, key: string): string | null {
  const value = slot.memo[key];
  return typeof value === 'string' ? value : null;
}

export class DreamNight {
  readonly #options: DreamNightOptions;
  #running: Promise<void> | null = null;

  constructor(options: DreamNightOptions) {
    this.#options = options;
  }

  slot(): TimedSlot {
    return this.#options.state.timedSlots.ensure(DREAM_SLOT_ID, 'dream');
  }

  tick(now: Date): void {
    const { state } = this.#options;
    const slot = this.slot();
    const zone = this.#options.zone();
    const key = `${zone}|${DREAM_CADENCE.type === 'daily' ? DREAM_CADENCE.at : ''}`;
    if (!slot.enabled) {
      if (slot.nextAt !== null) {
        state.timedSlots.update(slot.id, slot.version, { nextAt: null });
      }
      return;
    }
    const nextAt = slot.nextAt === null ? null : Date.parse(slot.nextAt);
    if (nextAt === null || (memoText(slot, 'key') !== key && nextAt > now.getTime())) {
      // 换了时区：按新时区重排，但不漏、不重复（见 rezonedNext）。
      const next = rezonedNext(DREAM_CADENCE, nextAt === null ? null : new Date(nextAt), now, zone,
        slot.lastRunAt === null ? null : new Date(slot.lastRunAt));
      state.timedSlots.update(slot.id, slot.version, { nextAt: next.toISOString(), memo: { ...slot.memo, key } });
      return;
    }
    if (nextAt > now.getTime() || this.#running !== null) {
      return;
    }
    if (this.#busy() >= (this.#options.limit?.() ?? MAX_BACKGROUND_LINES)) {
      state.timedSlots.update(slot.id, slot.version, { nextAt: new Date(now.getTime() + BUSY_RETRY_MS).toISOString(),
        lastNote: '后台线满着，等一会儿再整理' });
      return;
    }
    state.timedSlots.update(slot.id, slot.version, { nextAt: nextRun(DREAM_CADENCE, now, zone).toISOString(),
      lastRunAt: now.toISOString(), lastOutcome: null, lastNote: null });
    this.#running = this.run(now).catch((error: unknown) => {
      safeLog('error', 'dream_failed', { category: errorCategory(error), error });
    }).finally(() => {
      this.#running = null;
    });
  }

  async settled(): Promise<void> {
    await this.#running;
  }

  /** 整理一晚：从上次整理到的地方读到现在；之后写说明书（不管记忆这一晚整理成没有）。 */
  async run(now: Date): Promise<void> {
    await this.#dream(now);
    await this.#selfNotes(now);
  }

  async #selfNotes(now: Date): Promise<void> {
    if (this.#options.selfNotes === undefined) {
      return;
    }
    try {
      await this.#options.selfNotes(now, AbortSignal.timeout(NIGHT_TIMEOUT_MS));
    } catch (error) {
      safeLog('warn', 'self_notes_failed', { category: errorCategory(error) });
    }
  }

  async #dream(now: Date): Promise<void> {
    const dreamer = this.#options.dreamer();
    const from = memoText(this.slot(), 'coveredUntil') ?? new Date(now.getTime() - DAY_MS).toISOString();
    if (dreamer === null) {
      this.#finish('failed', '还没连模型，没法整理；下一晚再试', from);
      return;
    }
    try {
      const report = await dreamer.dream({ from, to: now.toISOString(), today: localDay(now, this.#options.zone()),
        fixSummaries: this.slot().memo['summariesFixed'] !== true, signal: AbortSignal.timeout(NIGHT_TIMEOUT_MS) });
      if (report.skipped) {
        this.#finish('skipped', '没有新对话，跳过', now.toISOString());
        return;
      }
      this.#finish('done', `整理了 ${report.changes} 条`, now.toISOString());
      if (report.docIds.length > 0) {
        this.#options.changed?.(report.docIds);
      }
    } catch (error) {
      safeLog('warn', 'dream_failed', { category: errorCategory(error) });
      const reason = error instanceof Error ? error.message : String(error);
      this.#finish('failed', `这一晚没整理成：${reason}；下一晚把这段补上`, from);
    }
  }

  setEnabled(on: boolean): void {
    const { state } = this.#options;
    const slot = this.slot();
    if (slot.enabled !== on) {
      state.timedSlots.update(slot.id, slot.version, { enabled: on,
        nextAt: on ? nextRun(DREAM_CADENCE, this.#options.now(), this.#options.zone()).toISOString() : null });
      this.#options.changed?.([]);
    }
  }

  row(): TimedRowView {
    const slot = this.slot();
    return {
      id: DREAM_SLOT_ID,
      source: 'dream',
      title: '做梦',
      summary: '每晚整理记忆',
      icon: 'moon',
      hue: 'olive',
      nextAt: slot.enabled ? slot.nextAt : null,
      last: this.#running !== null ? { glyph: 'run', text: '在整理' } : slotLast(slot, null, slot.enabled),
      enabled: slot.enabled,
      canToggle: true,
      canRemove: false,
      projectId: STANDING_PROJECT_IDS.personal,
      lineId: null,
      askId: null,
      teammateId: DREAM_SLOT_ID,
      sheet: false,
    };
  }

  provider(): TimedProvider {
    return {
      source: 'dream',
      rows: () => [this.row()],
      teammates: (): TeammateView[] => {
        const row = this.row();
        const slot = this.slot();
        const now = this.#running !== null ? '在整理' : slot.lastOutcome === 'done' ? `昨晚${slot.lastNote ?? ''}`
          : slot.lastNote ?? '';
        return [{ id: DREAM_SLOT_ID, name: '做梦', icon: row.icon, hue: row.hue,
          glyph: row.last?.glyph ?? (row.enabled ? 'idle' : 'pause'), now, rowIds: [row.id], lineId: null,
          canStop: row.enabled }];
      },
      setEnabled: (_rowId, on) => this.setEnabled(on),
      tick: (now) => this.tick(now),
    };
  }

  #busy(): number {
    return this.#options.state.lines.withStatus(['running']).filter((line) => line.kind === 'background').length;
  }

  /** 记上次。coveredUntil：整理到了哪一刻；没整理成的写这一晚开始读的地方，下一晚从那里接着读。 */
  #finish(outcome: 'done' | 'skipped' | 'failed', note: string, coveredUntil: string): void {
    const { state } = this.#options;
    const slot = this.slot();
    const memo = { ...slot.memo, coveredUntil, ...(outcome === 'done' ? { summariesFixed: true } : {}) };
    state.timedSlots.update(slot.id, slot.version, { lastOutcome: outcome,
      lastNote: Array.from(note).slice(0, 300).join(''), memo });
    this.#options.changed?.([]);
  }
}
