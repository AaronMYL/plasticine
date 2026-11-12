// 定时线（《优化清单》第 3 条：「到点替他做一件事」）。Plasticine 起草一张定时卡（draft），他在卡上点确认才生效；每次
// 到点往这张卡自己的后台线里放一条消息，和别的后台线一样排队、受并发上限（lines/ 的 MAX_BACKGROUND_LINES）。
// 错过的（设备关机、服务重启）「下次到点照常，补跑最近一次」；上一次还没做完的，这一次跳过，不往线里堆。
// 一轮做完记上次结果；结果放哪按卡上写的：每次都贴回主线（系统通知），或只在没做成时告诉他。

import type { LineInputOrigin, LineView } from '../../shared/api/index.ts';
import type { Ask, Schedule, ScheduleInput, ScheduleOutcome } from '../../shared/state.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import type { StateService } from '../state/index.ts';
import { cadenceLabel, latestDue, nextAfterRun, nextRun, rezonedNext } from './cadence.ts';
import { scheduleTimeZone } from './time-zone.ts';
import { outwardBrief } from './schedule-text.ts';
import { ensureScheduleGrant } from '../outbound/index.ts';
import { MAIN_LINE_ID } from '../state/index.ts';
import { scheduleActor, SCHEDULE_OWNER_CONTEXT_KEY } from './schedule-owner.ts';

/** 每分钟看一眼有没有到点的：卡上的钟点精确到分钟。 */
export const SCHEDULE_TICK_MS = 60_000;
/** 上次结果那一句写得下的长度。 */
const NOTE_MAX_CHARS = 80;
/** 在跑、排队、等他：上一次还没做完。 */
const BUSY: ReadonlySet<LineView['status']> = new Set(['running', 'queued', 'waiting']);

export type ScheduleState = Pick<StateService, 'schedules' | 'scheduleSends' | 'dailySettings' | 'deviceTimeZones'
  | 'outboundGrants' | 'asks' | 'lines' | 'mates'
  | 'projects' | 'transaction'>;

/** 定时线怎么动线（lines/ 的 LineKernel，assemble 接上）。 */
export interface ScheduleLines {
  open(input: { title: string; goal: string; projectId: string | null; origin: LineInputOrigin;
    mateId?: string }): string;
  send(lineId: string, text: string, origin: LineInputOrigin): void;
  view(lineId: string): LineView | null;
  halt(lineId: string): void;
}

export interface ScheduleNotice {
  key: string;
  text: string;
  brief: string;
  url: string;
}

export interface ScheduleDeskOptions {
  state: ScheduleState;
  now: () => Date;
  lines: () => ScheduleLines;
  /** 结果要告诉他时：主线一条系统通知（attention/ 的 Notices.post）。 */
  notify?: (notice: ScheduleNotice) => void;
  /** 定时列表变了（界面重读任务栏目）。 */
  changed?: () => void;
  /** 每分钟看完定时卡之后（订阅、心跳、做梦这些登记进来的行用同一个计时器）。 */
  afterTick?: (now: Date) => void;
}

export class ScheduleError extends Error {
  readonly code: 'not_found' | 'conflict';

  constructor(code: 'not_found' | 'conflict', message: string) {
    super(message);
    this.name = 'ScheduleError';
    this.code = code;
  }
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.trim().replace(/\s+/g, ' '));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** 一轮停下以后这一次的结果：做成；线自己说没做成；出错；叫停。还没停下（排队、在跑、等他）是 null。 */
export function outcomeOf(view: LineView): { outcome: ScheduleOutcome; note: string | null } | null {
  if (BUSY.has(view.status)) {
    return null;
  }
  if (view.outcome === 'done') {
    return view.unmet === undefined || view.unmet === null ? { outcome: 'done', note: view.lastAnswer }
      : { outcome: 'unmet', note: view.unmet };
  }
  if (view.outcome === 'stopped') {
    return { outcome: 'stopped', note: null };
  }
  if (view.outcome === 'failed' || view.outcome === 'incomplete' || view.status === 'failed') {
    return { outcome: 'failed', note: view.failure };
  }
  return null;
}

export class ScheduleDesk {
  readonly #options: ScheduleDeskOptions;
  readonly #state: ScheduleState;
  #zone: string | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ScheduleDeskOptions) {
    this.#options = options;
    this.#state = options.state;
  }

  timeZone(): string {
    return scheduleTimeZone(this.#state);
  }

  /** 服务启动：先按现在的时区排好下一次，再每分钟看一眼。 */
  start(): void {
    this.tick();
    this.#timer = setInterval(() => this.#safeTick(), SCHEDULE_TICK_MS);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  // —— 起草与确认 ——

  /** Plasticine 起草一张；同一次起草（同一条线的同一次调用）认回同一张。 */
  draft(input: ScheduleInput): Schedule {
    const existing = this.#state.schedules.byDraft(input.draftedBy);
    if (existing !== undefined) {
      return existing;
    }
    if (input.replacesId !== null) {
      const replaced = this.require(input.replacesId);
      if (replaced.status !== 'active' && replaced.status !== 'paused' && replaced.status !== 'draft') {
        throw new ScheduleError('conflict', '要改的那张定时卡已经不在用了。');
      }
    }
    const created = this.#state.schedules.create(input);
    this.#changed();
    return created;
  }

  /** 起草后出的那张要你定卡：记在卡上，确认时只认这一张。 */
  attachAsk(scheduleId: string, askId: string): Schedule {
    const schedule = this.require(scheduleId);
    if (schedule.confirmAskId === askId) {
      return schedule;
    }
    if (schedule.status !== 'draft' || schedule.confirmAskId !== null) {
      throw new ScheduleError('conflict', '这张定时卡已经出过确认卡了。');
    }
    return this.#state.schedules.update(schedule.id, schedule.version, { confirmAskId: askId });
  }

  /**
   * 他在卡上点了确认：卡生效，从现在起排下一次。确认来源只取这张卡的已认证作答（哪台设备、什么时候），照卡发送对回这里。
   * 改的是旧卡：旧卡换掉，定时线接着用旧卡那条。
   */
  confirm(scheduleId: string, ask: Ask): Schedule {
    const schedule = this.require(scheduleId);
    if (schedule.status === 'active' && schedule.confirmAskId === ask.id) {
      return schedule;
    }
    if (schedule.status !== 'draft') {
      throw new ScheduleError('conflict', '这张定时卡已经不等确认了。');
    }
    if (schedule.confirmAskId !== ask.id) {
      throw new ScheduleError('conflict', '确认的不是这张定时卡出的那张卡。');
    }
    if (ask.status !== 'answered' || ask.answeredAt === null || ask.answeredByDeviceId === null) {
      throw new ScheduleError('conflict', '他还没在卡上确认。');
    }
    const now = this.#options.now();
    const confirmed = this.#state.transaction(() => {
      const actor = scheduleActor(this.#state, schedule);
      const confirmation = this.#state.asks.require(ask.id);
      this.#state.asks.update(confirmation.id, confirmation.version,
        { context: { ...confirmation.context, [SCHEDULE_OWNER_CONTEXT_KEY]: actor } });
      let lineId: string | null = schedule.lineId;
      if (schedule.replacesId !== null) {
        const old = this.require(schedule.replacesId);
        lineId = old.lineId;
        this.#state.schedules.update(old.id, old.version, { status: 'replaced', nextAt: null });
      }
      const row = this.#state.schedules.update(schedule.id, schedule.version, { status: 'active', lineId,
        nextAt: nextRun(schedule.cadence, now, this.timeZone()).toISOString(), confirmAskId: ask.id,
        confirmedAt: ask.answeredAt, confirmedByDeviceId: ask.answeredByDeviceId });
      ensureScheduleGrant(this.#state, row);
      return row;
    });
    this.#changed();
    return confirmed;
  }

  /** 他没确认（先不 / 改一下）：这张不生效。 */
  decline(scheduleId: string): Schedule {
    const schedule = this.require(scheduleId);
    if (schedule.status !== 'draft') {
      return schedule;
    }
    const declined = this.#state.schedules.update(schedule.id, schedule.version, { status: 'declined' });
    this.#changed();
    return declined;
  }

  // —— 停、开、删 ——

  /** 开关：停了不再到点；打开从现在起排下一次。等确认的卡不能拨（要在卡上确认）。 */
  setEnabled(scheduleId: string, on: boolean): Schedule {
    const schedule = this.require(scheduleId);
    if (schedule.status === 'draft') {
      throw new ScheduleError('conflict', '这张定时卡还在等你确认：在对话里的卡上点确认才生效。');
    }
    if (schedule.status !== 'active' && schedule.status !== 'paused') {
      throw new ScheduleError('conflict', '这张定时卡已经不在用了。');
    }
    if ((schedule.status === 'active') === on) {
      return schedule;
    }
    const nextAt = on ? nextRun(schedule.cadence, this.#options.now(), this.timeZone()).toISOString() : null;
    const updated = this.#state.schedules.update(schedule.id, schedule.version,
      { status: on ? 'active' : 'paused', nextAt });
    if (!on) {
      this.#haltRunning(updated);
    }
    this.#changed();
    return updated;
  }

  /** 删：只标记，行留着（照卡发送的记录要能对回这张卡）；正在跑的那一轮停下。 */
  remove(scheduleId: string): Schedule {
    const schedule = this.require(scheduleId);
    if (schedule.status === 'removed') {
      return schedule;
    }
    const removed = this.#state.schedules.update(schedule.id, schedule.version, { status: 'removed', nextAt: null,
      removedAt: this.#options.now().toISOString() });
    this.#haltRunning(removed);
    this.#changed();
    return removed;
  }

  require(scheduleId: string): Schedule {
    const schedule = this.#state.schedules.get(scheduleId);
    if (schedule === undefined) {
      throw new ScheduleError('not_found', '没有这张定时卡。');
    }
    return schedule;
  }

  /** 这条线是哪张定时卡的；不是定时线是 undefined。 */
  forLine(lineId: string): Schedule | undefined {
    const schedule = this.#state.schedules.byLine(lineId);
    return schedule === undefined || schedule.status === 'replaced' ? this.#current(lineId) : schedule;
  }

  // —— 到点 ——

  /** 看一眼：时区变了就按新时区重排；到点的各放一条进它的线。 */
  tick(): void {
    const now = this.#options.now();
    const zone = this.timeZone();
    if (zone !== this.#zone) {
      this.#rezone(now, zone);
      this.#zone = zone;
    }
    for (const schedule of this.#state.schedules.due(now.toISOString())) {
      try {
        this.#fire(schedule, now, zone);
      } catch (error) {
        safeLog('error', 'schedule_fire_failed', { objectId: schedule.id, category: errorCategory(error), error });
      }
    }
    this.#options.afterTick?.(now);
  }

  /** 一轮停下以后（lines/ 的 turnEnded）：是定时线就记上次结果，按卡上写的告诉他。 */
  ended(lineId: string): void {
    const schedule = this.forLine(lineId);
    if (schedule === undefined) {
      return;
    }
    const view = this.#options.lines().view(lineId);
    const result = view === null ? null : outcomeOf(view);
    if (result === null) {
      return;
    }
    const note = result.note === null ? null : clip(result.note, NOTE_MAX_CHARS);
    const latest = this.require(schedule.id);
    this.#state.schedules.update(latest.id, latest.version, { lastOutcome: result.outcome, lastNote: note });
    this.#changed();
    const tell = latest.report === 'always' || result.outcome === 'unmet' || result.outcome === 'failed';
    if (tell && result.outcome !== 'stopped') {
      this.#tell(latest, result.outcome, note);
    }
  }

  #fire(schedule: Schedule, now: Date, zone: string): void {
    if (schedule.nextAt === null) {
      return;
    }
    const due = latestDue(schedule.cadence, new Date(schedule.nextAt), now, zone);
    const next = nextAfterRun(schedule.cadence, due, now, zone).toISOString();
    const actor = scheduleActor(this.#state, schedule);
    if (actor !== MAIN_LINE_ID && this.#state.mates.require(actor).disabledAt !== null) {
      this.#state.schedules.update(schedule.id, schedule.version, { nextAt: next,
        lastNote: '负责这项定时工作的队友已停用，这一次没有执行' });
      this.#changed();
      return;
    }
    const lines = this.#options.lines();
    const view = schedule.lineId === null ? null : lines.view(schedule.lineId);
    if (view !== null && BUSY.has(view.status)) {
      this.#state.schedules.update(schedule.id, schedule.version, { nextAt: next,
        lastNote: '上一次还没做完，这一次跳过' });
      this.#changed();
      return;
    }
    const text = this.#runText(schedule, due, zone);
    const origin: LineInputOrigin = { kind: 'trigger', ref: `schedule:${schedule.id}` };
    // 先记下这一次（下次时间、这次是哪一刻），再放进线：放的时候线会读这一次去核照卡发送。
    const recorded = this.#state.schedules.update(schedule.id, schedule.version, { nextAt: next,
      lastRunAt: due.toISOString(), lastOutcome: null, lastNote: null });
    let lineId = recorded.lineId;
    if (lineId === null || view === null) {
      lineId = lines.open({ title: schedule.title, goal: text, projectId: schedule.projectId, origin,
        ...(actor === MAIN_LINE_ID ? {} : { mateId: actor }) });
      this.#state.schedules.update(recorded.id, recorded.version, { lineId });
    } else {
      lines.send(lineId, text, origin);
    }
    this.#changed();
  }

  /** 放进定时线的那段话：这是哪张卡、这一次是哪一刻、要做什么；照卡发送的卡写清范围和放行的做法。 */
  #runText(schedule: Schedule, due: Date, zone: string): string {
    const at = due.toLocaleString('zh-CN', { timeZone: zone, month: 'numeric', day: 'numeric', hour: '2-digit',
      minute: '2-digit', hourCycle: 'h23' });
    const parts = [`定时任务「${schedule.title}」到点了（${cadenceLabel(schedule.cadence)}，这一次：${at}）。`,
      `要做的事：${schedule.goal}`];
    if (schedule.place !== null) {
      parts.push(`在哪做：${schedule.place}。`);
    }
    if (schedule.outward !== null) {
      parts.push(outwardBrief(schedule.outward));
    }
    parts.push('做完调 line_outcome 说做成没有；没做成写一句原因。');
    return parts.join('\n');
  }

  #tell(schedule: Schedule, outcome: ScheduleOutcome, note: string | null): void {
    if (this.#options.notify === undefined) {
      return;
    }
    const head = outcome === 'done' ? `定时任务「${schedule.title}」做完了` : `定时任务「${schedule.title}」这次没做成`;
    const text = note === null ? `${head}。` : `${head}：${note}`;
    try {
      this.#options.notify({ key: `schedule:${schedule.id}:${schedule.lastRunAt ?? 'manual'}:${outcome}`, text,
        brief: head, url: schedule.lineId === null ? '/#/tasks/timed' : `/#/work/${schedule.lineId}` });
    } catch (error) {
      safeLog('error', 'schedule_notice_failed', { objectId: schedule.id, category: errorCategory(error) });
    }
  }

  /** 时区变了（出差）：还没到点的按新时区的同一个钟点重排；已经到点的照常补跑。每隔几分钟的不受影响。 */
  #rezone(now: Date, zone: string): void {
    for (const schedule of this.#state.schedules.listed()) {
      if (schedule.status !== 'active' || schedule.cadence.type === 'interval') {
        continue;
      }
      if (schedule.nextAt !== null && Date.parse(schedule.nextAt) <= now.getTime()) {
        continue;
      }
      const next = rezonedNext(schedule.cadence, schedule.nextAt === null ? null : new Date(schedule.nextAt), now, zone,
        schedule.lastRunAt === null ? null : new Date(schedule.lastRunAt)).toISOString();
      if (next !== schedule.nextAt) {
        this.#state.schedules.update(schedule.id, schedule.version, { nextAt: next });
      }
    }
  }

  #haltRunning(schedule: Schedule): void {
    if (schedule.lineId === null) {
      return;
    }
    const view = this.#options.lines().view(schedule.lineId);
    if (view !== null && BUSY.has(view.status)) {
      this.#options.lines().halt(schedule.lineId);
    }
  }

  /** 改过的卡：线还挂在旧卡上时，找接着用这条线的那张新卡。 */
  #current(lineId: string): Schedule | undefined {
    return this.#state.schedules.listed().find((schedule) => schedule.lineId === lineId);
  }

  #safeTick(): void {
    try {
      this.tick();
    } catch (error) {
      safeLog('error', 'schedule_tick_failed', { category: errorCategory(error), error });
    }
  }

  #changed(): void {
    try {
      this.#options.changed?.();
    } catch (error) {
      safeLog('error', 'schedule_changed_hook_failed', { category: errorCategory(error) });
    }
  }
}
