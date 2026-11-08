// 订阅登记进「定时」（《优化清单》第 3、6、7 条接线）：研究周报一行、个人回顾的日报和周报各一行，用 tasks 的计时器
// （每分钟看一眼）到点调 runSubscription；按他所在地的时区（11-07 定：设置里选的 → 最近设备报的 → 北京时间）。
// 错过的照定时线的做法：下次到点照常，补跑最近一次；上一期还没写完，这一次跳过。
// 暂停 = 订阅停下（回顾是那一种关掉）；删 = 关掉订阅、这一行不再列出，订阅和往期都留着。
// 回顾写完，「值得跟进」那一节的每一条进建议（tasks.suggestions.suggest，同一条只提一次）。

import type { LineView, TeammateView, TimedRowView } from '../../shared/api/index.ts';
import { STANDING_PROJECT_IDS, type ScheduleCadence, type SpaceEdition, type Subscription, type TimedSlot }
  from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { cadenceLabel, latestDue, lineOutcome, nextRun, slotLast, teammatesFromRows, type TimedProvider }
  from '../tasks/index.ts';
import type { SuggestionInputDraft } from '../tasks/index.ts';
import { followUps } from './follow-ups.ts';
import { runSubscription, type RunPort, type RunState } from './run.ts';
import { schedulesOf } from './schedule.ts';
import { changeSubscription } from './writes.ts';

export type SubsTimedState = RunState & Pick<StateService, 'timedSlots' | 'transaction'>;

export interface SubsTimedLines {
  port(): RunPort;
  view(lineId: string): LineView | null;
  halt(lineId: string): void;
}

export interface SubsTimedOptions {
  state: SubsTimedState;
  lines: SubsTimedLines;
  now: () => Date;
  /** 他所在地的时区（tasks 的 scheduleTimeZone）。 */
  zone: () => string;
  suggest?: (input: SuggestionInputDraft) => void;
  changed?: () => void;
}

interface Entry {
  subscription: Subscription;
  edition: SpaceEdition | null;
  slotId: string;
  cadence: ScheduleCadence;
  /** 现在开着（到点会出）。 */
  on: boolean;
}

const BUSY: ReadonlySet<LineView['status']> = new Set(['running', 'queued', 'waiting']);
const EDITION_TITLE: Record<SpaceEdition, string> = { daily: '日报', weekly: '周报' };

function slotIdOf(subscription: Subscription, edition: SpaceEdition | null): string {
  return subscription.settings.kind === 'review' ? `review:${edition ?? 'daily'}` : `subscription:${subscription.id}`;
}

/** 订阅的时间换成定时的钟点（每周的周日在订阅里是 0，在定时里是 7）。 */
function cadenceOf(schedule: { every: 'day' | 'week'; weekday?: number; time: string }): ScheduleCadence {
  if (schedule.every === 'day') {
    return { type: 'daily', at: schedule.time };
  }
  const weekday = schedule.weekday ?? 1;
  return { type: 'weekly', days: [weekday === 0 ? 7 : weekday], at: schedule.time };
}

export class SubscriptionTimed {
  readonly #options: SubsTimedOptions;

  constructor(options: SubsTimedOptions) {
    this.#options = options;
  }

  /** 两个来源各一份登记：研究周报（subscription）、个人回顾（review）。 */
  providers(): TimedProvider[] {
    return [this.#provider('subscription'), this.#provider('review')];
  }

  /** 列出来的：开着的，和暂停了但没删的；草案、样刊阶段的还不算定时。 */
  entries(): Entry[] {
    const { state } = this.#options;
    const entries: Entry[] = [];
    for (const subscription of state.subscriptions.all()) {
      const { settings } = subscription;
      if (settings.kind === 'research') {
        const slotId = slotIdOf(subscription, null);
        const on = subscription.status === 'active';
        if (on || (subscription.status === 'paused' && !this.#removed(slotId))) {
          entries.push({ subscription, edition: null, slotId, on, cadence: cadenceOf(settings.schedule) });
        }
        continue;
      }
      const active = new Set(schedulesOf(subscription).map((slot) => slot.edition));
      const editions: { edition: SpaceEdition; schedule: { every: 'day' | 'week'; weekday?: number; time: string } }[]
        = [{ edition: 'daily', schedule: { every: 'day', time: settings.daily.time } },
          { edition: 'weekly', schedule: { every: 'week', weekday: settings.weekly.weekday,
            time: settings.weekly.time } }];
      for (const { edition, schedule } of editions) {
        const slotId = slotIdOf(subscription, edition);
        const on = active.has(edition);
        if (on || !this.#removed(slotId)) {
          entries.push({ subscription, edition, slotId, on, cadence: cadenceOf(schedule) });
        }
      }
    }
    return entries;
  }

  /** 每分钟一次：到点的放一条消息进它的线。 */
  tick(now: Date): void {
    for (const entry of this.entries()) {
      this.#check(entry, now);
    }
  }

  /** 订阅的线一轮停下：记上次结果；回顾做成了，把「值得跟进」提成建议。 */
  ended(lineId: string): void {
    const { state, lines } = this.#options;
    const subscription = state.subscriptions.all().find((item) => item.lineId === lineId);
    if (subscription === undefined) {
      return;
    }
    const view = lines.view(lineId);
    const result = view === null ? null : lineOutcome(view);
    if (result === null) {
      return;
    }
    const slot = this.entries().filter((entry) => entry.subscription.id === subscription.id)
      .map((entry) => state.timedSlots.get(entry.slotId))
      .filter((item): item is TimedSlot => item !== undefined && item.lastRunAt !== null && item.lastOutcome === null)
      .sort((a, b) => Date.parse(b.lastRunAt ?? '') - Date.parse(a.lastRunAt ?? ''))[0];
    if (slot === undefined) {
      return;
    }
    state.timedSlots.update(slot.id, slot.version, { lastOutcome: result.outcome,
      lastNote: result.note === null ? null : Array.from(result.note).slice(0, 300).join('') });
    if (result.outcome === 'done' && subscription.settings.kind === 'review') {
      this.#suggestFollowUps(subscription, slot);
    }
    this.#options.changed?.();
  }

  setEnabled(rowId: string, on: boolean): void {
    const entry = this.#entry(rowId);
    const { state } = this.#options;
    const { subscription } = entry;
    if (subscription.settings.kind === 'research') {
      changeSubscription(state, subscription.id, subscription.version, { status: on ? 'active' : 'paused' });
    } else {
      const edition = entry.edition ?? 'daily';
      const settings = { ...subscription.settings, [edition]: { ...subscription.settings[edition], on } };
      changeSubscription(state, subscription.id, subscription.version, { settings,
        ...(on && subscription.status !== 'active' ? { status: 'active' as const } : {}) });
    }
    if (!on) {
      this.#haltRunning(subscription);
    }
    const slot = state.timedSlots.ensure(entry.slotId, entry.edition === null ? 'subscription' : 'review');
    state.timedSlots.update(slot.id, slot.version, { nextAt: on ? this.#next(entry, this.#options.now()) : null,
      removedAt: on ? null : slot.removedAt, memo: { key: this.#key(entry) } });
    this.#options.changed?.();
  }

  /** 删 = 关掉订阅（回顾是关掉那一种），这一行不再列出；订阅和往期都留着。 */
  remove(rowId: string): void {
    const entry = this.#entry(rowId);
    if (entry.on) {
      this.setEnabled(rowId, false);
    }
    const { state } = this.#options;
    const slot = state.timedSlots.ensure(entry.slotId, entry.edition === null ? 'subscription' : 'review');
    state.timedSlots.update(slot.id, slot.version, { removedAt: this.#options.now().toISOString(), nextAt: null });
    this.#options.changed?.();
  }

  rows(source: 'subscription' | 'review'): TimedRowView[] {
    return this.entries().filter((entry) => (entry.edition === null) === (source === 'subscription'))
      .map((entry) => this.#row(entry));
  }

  #provider(source: 'subscription' | 'review'): TimedProvider {
    const name = source === 'subscription' ? '研究员' : '回顾';
    return {
      source,
      rows: () => this.rows(source),
      teammates: (): TeammateView[] => teammatesFromRows(this.rows(source), (row) => {
        const view = row.lineId === null ? null : this.#options.lines.view(row.lineId);
        const busy = view !== null && (view.status === 'running' || view.status === 'queued');
        return { name, activity: busy ? view.activity ?? '在写' : null, lineId: row.lineId };
      }),
      setEnabled: (rowId, on) => this.setEnabled(rowId, on),
      remove: (rowId) => this.remove(rowId),
      // 两个来源共用一个计时：只让研究周报那一份去看，免得一分钟看两遍。
      ...(source === 'subscription' ? { tick: (now: Date) => this.tick(now),
        ended: (lineId: string) => this.ended(lineId) } : {}),
    };
  }

  #row(entry: Entry): TimedRowView {
    const { subscription, edition } = entry;
    const slot = this.#options.state.timedSlots.get(entry.slotId);
    const view = subscription.lineId === null ? null : this.#options.lines.view(subscription.lineId);
    const review = edition !== null;
    return {
      id: entry.slotId,
      source: review ? 'review' : 'subscription',
      title: review ? EDITION_TITLE[edition] : subscription.title,
      summary: `${cadenceLabel(entry.cadence)} · ${review ? '个人回顾' : '订阅'}`,
      icon: review ? 'sparkle' : 'space',
      hue: review ? 'teal' : 'sky',
      nextAt: entry.on ? slot?.nextAt ?? this.#next(entry, this.#options.now()) : null,
      last: slotLast(slot, view, entry.on),
      enabled: entry.on,
      canToggle: true,
      canRemove: true,
      projectId: STANDING_PROJECT_IDS.personal,
      lineId: subscription.lineId,
      askId: null,
      teammateId: review ? 'review' : 'researcher',
      sheet: false,
    };
  }

  #check(entry: Entry, now: Date): void {
    const { state } = this.#options;
    let slot = state.timedSlots.ensure(entry.slotId, entry.edition === null ? 'subscription' : 'review');
    if (!entry.on) {
      if (slot.nextAt !== null) {
        state.timedSlots.update(slot.id, slot.version, { nextAt: null });
      }
      return;
    }
    if (slot.removedAt !== null) {
      // 在订阅页里又开了：这一行回来。
      slot = state.timedSlots.update(slot.id, slot.version, { removedAt: null });
    }
    const key = this.#key(entry);
    const nextAt = slot.nextAt === null ? null : Date.parse(slot.nextAt);
    if (nextAt === null || (slot.memo['key'] !== key && nextAt > now.getTime())) {
      // 第一次、刚打开、改了时间或换了时区（出差）：从现在起按新的钟点排。
      state.timedSlots.update(slot.id, slot.version, { nextAt: this.#next(entry, now), memo: { key } });
      return;
    }
    if (nextAt > now.getTime()) {
      return;
    }
    this.#fire(entry, slot, now, key);
  }

  #fire(entry: Entry, slot: TimedSlot, now: Date, key: string): void {
    const { state, lines } = this.#options;
    const zone = this.#options.zone();
    const due = latestDue(entry.cadence, new Date(slot.nextAt ?? now.toISOString()), now, zone);
    const next = nextRun(entry.cadence, now, zone).toISOString();
    // 现读：同一分钟里日报刚开了线，周报要看到它。
    const subscription = state.subscriptions.require(entry.subscription.id);
    const view = subscription.lineId === null ? null : lines.view(subscription.lineId);
    if (view !== null && BUSY.has(view.status)) {
      state.timedSlots.update(slot.id, slot.version, { nextAt: next, lastOutcome: 'skipped',
        lastNote: '上一期还没写完，这一次跳过', memo: { key } });
      this.#options.changed?.();
      return;
    }
    // 先记下这一次，再放进线：放的时候出错，下次到点照常，不会一分钟重放一次。
    const recorded = state.timedSlots.update(slot.id, slot.version, { nextAt: next, lastRunAt: due.toISOString(),
      lastOutcome: null, lastNote: null, memo: { key } });
    const { lineId } = runSubscription(state, lines.port(), subscription.id, due, entry.edition, null);
    state.timedSlots.update(recorded.id, recorded.version, { lineId });
    this.#options.changed?.();
  }

  #suggestFollowUps(subscription: Subscription, slot: TimedSlot): void {
    const suggest = this.#options.suggest;
    if (suggest === undefined) {
      return;
    }
    // 这一期写的就是最新的那一期；今天跳过没写的，最新的还是上一期，它的那几条提过了（同一个 key 不再出）。
    const edition = slot.id === 'review:weekly' ? 'weekly' : 'daily';
    const issue = this.#options.state.spaces.issues(subscription.id).find((space) => space.edition === edition);
    if (issue === undefined) {
      return;
    }
    for (const item of followUps(issue)) {
      suggest({ title: item.title, why: `回顾${EDITION_TITLE[edition]}里「值得跟进」的一条`, goal: item.goal, projectId: null,
        source: 'review', icon: 'sparkle', key: item.key, sourceRef: `space:${issue.id}` });
    }
  }

  #entry(rowId: string): Entry {
    const entry = this.entries().find((item) => item.slotId === rowId);
    if (entry === undefined) {
      throw new Error(`定时列表里没有这一项：${rowId}`);
    }
    return entry;
  }

  #removed(slotId: string): boolean {
    return (this.#options.state.timedSlots.get(slotId)?.removedAt ?? null) !== null;
  }

  #key(entry: Entry): string {
    return `${this.#options.zone()}|${JSON.stringify(entry.cadence)}`;
  }

  #next(entry: Entry, now: Date): string {
    return nextRun(entry.cadence, now, this.#options.zone()).toISOString();
  }

  #haltRunning(subscription: Subscription): void {
    const { lines } = this.#options;
    const view = subscription.lineId === null ? null : lines.view(subscription.lineId);
    if (view !== null && subscription.lineId !== null && BUSY.has(view.status)) {
      lines.halt(subscription.lineId);
    }
  }
}
