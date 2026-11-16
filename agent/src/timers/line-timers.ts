// 线的两种定时（11-16 能力总表）：line_wake_later 过多久（或到几点）这条线自己再跑一轮，带一句要看什么；
// watch_start 隔一段时间看一个网页（公网的直接读，要他登录的读 Mac 上那个标签），变了（或出现了要等的那段字）就
// 叫醒这条线。只叫醒自己这条线，不用问他；每个「回来看」「盯着」他在任务的「在做」里看得到、能关。
// 一个计时器排到最近要做的那件事；到点把到期的都做了再排下一次。最长隔 MAX_SLEEP_MS 醒一次核对（时钟跳了也不误）。

import { Type } from 'typebox';
import type { TimerView } from '../../shared/api/timers.ts';
import { checkedArgs, type KernelTool, type Later, type LineScope, type ToolArgs } from '../lines/index.ts';
import type { LineWake, LineWatch, StateService } from '../state/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';

const MINUTE_MS = 60_000;
/** 回来看最短 1 分钟、最长 7 天：再久该是定时任务（schedule_propose），由他确认。 */
const WAKE_MAX_MINUTES = 7 * 24 * 60;
/** 盯着最密 5 分钟看一次（别人家的网站经不起更密），最多盯 14 天。 */
export const WATCH_MIN_MINUTES = 5;
const WATCH_DEFAULT_MINUTES = 30;
const WATCH_DEFAULT_HOURS = 24;
const WATCH_MAX_HOURS = 14 * 24;
/** 一条线同时最多盯这么多处。 */
const WATCH_PER_LINE_MAX = 5;
/** 计时器最长睡这么久就醒一次核对。 */
const MAX_SLEEP_MS = 10 * MINUTE_MS;
/** 存下来比对的字最多这么长；叫醒时新出现的那些最多给这么多字。 */
const KEPT_CHARS = 20_000;
const CHANGE_CHARS = 1_500;
const NOTE_MAX_CHARS = 300;

export interface LineTimerDeps {
  state: Pick<StateService, 'lineTimers' | 'lines'>;
  now(): Date;
  later: Later;
  /** 叫醒一条线：往里说一句（系统发起的消息）。 */
  wake(lineId: string, text: string, ref: string): void;
  /** 看一眼盯着的那一处现在的字（网页正文或 Mac 上那个标签的字）。 */
  read(watch: LineWatch, signal: AbortSignal): Promise<string>;
  /** 列表变了（界面重读）。 */
  changed(): void;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
}

/** 比对用的字：行内空白收成一个，空行去掉。 */
export function watchText(raw: string): string {
  return clip(raw.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line !== '')
    .join('\n'), KEPT_CHARS);
}

/** 新出现的那些行（旧的里没有的）。 */
export function addedLines(before: string, after: string): string {
  const old = new Set(before.split('\n'));
  return clip(after.split('\n').filter((line) => !old.has(line)).join('\n'), CHANGE_CHARS);
}

function clock(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'Asia/Shanghai' });
}

const WakeParameters = Type.Object({
  minutes: Type.Optional(Type.Integer({ minimum: 1, maximum: WAKE_MAX_MINUTES, description: '过多少分钟' })),
  at: Type.Optional(Type.String({ format: 'date-time', description: '或者到这个时间（ISO，带时区）' })),
  note: Type.String({ minLength: 2, maxLength: NOTE_MAX_CHARS, description: '到时候要看什么、接着做什么' }),
}, { additionalProperties: false });

const WatchParameters = Type.Object({
  title: Type.String({ minLength: 2, maxLength: 40, description: '盯的是什么，他在「在做」里看到的就是这句' }),
  url: Type.Optional(Type.String({ minLength: 8, maxLength: 2_000, pattern: '^https?://',
    description: '不用登录的网页' })),
  nodeId: Type.Optional(Type.String({ minLength: 1, description: '要他登录的页面：Mac 的 nodeId' })),
  tabId: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: '和 nodeId 一起：Mac 上那个标签' })),
  lookFor: Type.Optional(Type.String({ minLength: 1, maxLength: 100,
    description: '等这段字出现就叫（如「已发货」）；不给就是页面有变化就叫' })),
  everyMinutes: Type.Optional(Type.Integer({ minimum: WATCH_MIN_MINUTES, maximum: 24 * 60 })),
  hours: Type.Optional(Type.Integer({ minimum: 1, maximum: WATCH_MAX_HOURS, description: '最多盯几个小时' })),
}, { additionalProperties: false });

const StopParameters = Type.Object({ id: Type.String({ minLength: 1, maxLength: 100 }) },
  { additionalProperties: false });

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} };
}

export class LineTimers {
  readonly #deps: LineTimerDeps;
  #cancel: (() => void) | null = null;
  #busy = false;
  #stopped = false;

  constructor(deps: LineTimerDeps) {
    this.#deps = deps;
  }

  start(): void {
    this.#stopped = false;
    this.#arm();
  }

  stop(): void {
    this.#stopped = true;
    this.#cancel?.();
    this.#cancel = null;
  }

  /** 他在「在做」里看到的：还在等的回来看、还开着的盯着。 */
  views(): TimerView[] {
    const { lineTimers, lines } = this.#deps.state;
    const title = (lineId: string): string => lines.get(lineId)?.title ?? '';
    return [
      ...lineTimers.wakes.waiting().map((wake): TimerView => ({ id: wake.id, kind: 'wake', lineId: wake.lineId,
        lineTitle: title(wake.lineId), title: wake.note, nextAt: wake.dueAt, checks: 0, lastError: null })),
      ...lineTimers.watches.on().map((watch): TimerView => ({ id: watch.id, kind: 'watch', lineId: watch.lineId,
        lineTitle: title(watch.lineId), title: watch.title, nextAt: watch.nextAt, checks: watch.checks,
        lastError: watch.lastError })),
    ].sort((a, b) => a.nextAt.localeCompare(b.nextAt));
  }

  /** 他关掉一条（回来看撤掉、盯着停下）。 */
  cancel(id: string): void {
    const { lineTimers } = this.#deps.state;
    if (id.startsWith('wake_')) {
      lineTimers.wakes.end(id, 'cancelled');
    } else {
      lineTimers.watches.stop(id);
    }
    this.#deps.changed();
    this.#arm();
  }

  tools(): KernelTool[] {
    return [this.#wakeTool(), this.#watchTool(), this.#stopTool()];
  }

  /** 到期的都做了：回来看的往线里说一句，盯着的一个个看。 */
  async tick(): Promise<void> {
    if (this.#busy) {
      return;
    }
    this.#busy = true;
    try {
      const at = this.#deps.now().toISOString();
      for (const wake of this.#deps.state.lineTimers.wakes.due(at)) {
        this.#fire(wake);
      }
      for (const watch of this.#deps.state.lineTimers.watches.due(at)) {
        await this.#check(watch);
      }
    } finally {
      this.#busy = false;
      this.#arm();
    }
  }

  #arm(): void {
    this.#cancel?.();
    this.#cancel = null;
    if (this.#stopped) {
      return;
    }
    const { lineTimers } = this.#deps.state;
    const next = [lineTimers.wakes.waiting()[0]?.dueAt, lineTimers.watches.on()[0]?.nextAt]
      .filter((value): value is string => value !== undefined).sort()[0];
    if (next === undefined) {
      return;
    }
    const wait = Math.min(MAX_SLEEP_MS, Math.max(0, Date.parse(next) - this.#deps.now().getTime()));
    this.#cancel = this.#deps.later(wait, () => {
      this.tick().catch((error: unknown) => {
        safeLog('error', 'line_timers_tick_failed', { category: errorCategory(error) });
      });
    });
  }

  #fire(wake: LineWake): void {
    this.#deps.state.lineTimers.wakes.end(wake.id, 'woken');
    this.#deps.changed();
    if (!this.#alive(wake.lineId)) {
      return;
    }
    this.#deps.wake(wake.lineId, `到点了（${clock(wake.dueAt)} 约好回来看）：${wake.note}`, `wake:${wake.id}`);
  }

  #alive(lineId: string): boolean {
    const line = this.#deps.state.lines.get(lineId);
    return line !== undefined && line.archivedAt == null && line.pauseReason !== 'stopped';
  }

  async #check(watch: LineWatch): Promise<void> {
    const now = this.#deps.now();
    const nextAt = new Date(now.getTime() + watch.everyMinutes * MINUTE_MS).toISOString();
    const expired = now.toISOString() >= watch.untilAt;
    const { lineTimers } = this.#deps.state;
    if (!this.#alive(watch.lineId)) {
      lineTimers.watches.stop(watch.id);
      this.#deps.changed();
      return;
    }
    let text: string;
    try {
      text = watchText(await this.#deps.read(watch, AbortSignal.timeout(2 * MINUTE_MS)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      lineTimers.watches.checked(watch.id, { text: null, changed: false, error: clip(reason, 200), nextAt,
        ended: expired });
      this.#deps.changed();
      return;
    }
    const found = watch.lookFor !== null && text.includes(watch.lookFor);
    const changed = watch.lookFor === null ? watch.lastText !== null && watch.lastText !== text : found;
    const ended = expired || found;
    lineTimers.watches.checked(watch.id, { text, changed, error: null, nextAt, ended });
    this.#deps.changed();
    if (found) {
      this.#deps.wake(watch.lineId, `盯着的「${watch.title}」里出现了「${watch.lookFor ?? ''}」（${clock(now.toISOString())}），`
        + `不再盯了。那一段附近：\n${clip(text.slice(Math.max(0, text.indexOf(watch.lookFor ?? '') - 200)), CHANGE_CHARS)}`,
      `watch:${watch.id}`);
    } else if (changed) {
      this.#deps.wake(watch.lineId, `盯着的「${watch.title}」有变化（${clock(now.toISOString())}）。新出现的：\n`
        + `${addedLines(watch.lastText ?? '', text) || '（只是删了些字）'}\n要看全貌就去读那一页；不用再盯了用 watch_stop`
        + `（${watch.id}）。`, `watch:${watch.id}`);
    } else if (expired) {
      this.#deps.wake(watch.lineId, `盯着的「${watch.title}」到期了（盯了 ${watch.checks + 1} 次），一直没等到变化。`,
        `watch:${watch.id}`);
    }
  }

  #wakeTool(): KernelTool {
    return {
      name: 'line_wake_later',
      say: (args: ToolArgs) => (typeof args['minutes'] === 'number' ? `${args['minutes']} 分钟后回来看` : '到点回来看'),
      hardLine: () => null,
      create: (scope: LineScope) => ({
        name: 'line_wake_later', label: '过一会儿回来看',
        description: '这条线过多久（minutes）或到几点（at）自己再跑一轮，带一句到时要看什么（note）：30 分钟后看 HR 回了没、'
          + '明早接着投。不用问他；他在任务的「在做」里看得到、能关。要每天、每周按时做的事用 schedule_propose。',
        parameters: WakeParameters,
        execute: async (callId: string, input: unknown) => {
          const args = checkedArgs(WakeParameters, input, 'line_wake_later');
          if ((args.minutes === undefined) === (args.at === undefined)) {
            throw new Error('minutes 和 at 给一样。');
          }
          const now = this.#deps.now().getTime();
          const due = args.minutes === undefined ? Date.parse(args.at ?? '') : now + args.minutes * MINUTE_MS;
          if (!Number.isFinite(due) || due <= now || due > now + WAKE_MAX_MINUTES * MINUTE_MS) {
            throw new Error('时间要在现在之后、7 天以内。');
          }
          const wake = this.#deps.state.lineTimers.wakes.add({ lineId: scope.lineId,
            callKey: `${scope.lineId}:${callId}`, dueAt: new Date(due).toISOString(), note: args.note });
          this.#deps.changed();
          this.#arm();
          return json({ id: wake.id, dueAt: wake.dueAt, note: '到点会往这条线里说一句，这一轮可以先结束。' });
        },
      }),
    };
  }

  #watchTool(): KernelTool {
    return {
      name: 'watch_start',
      say: (args: ToolArgs) => `盯着：${String(args['title'] ?? '')}`,
      hardLine: () => null,
      create: (scope: LineScope) => ({
        name: 'watch_start', label: '盯着变化',
        description: '隔一段时间看一处，变了（或出现了 lookFor 那段字）就叫醒这条线：招聘回复、价格、发货、公告、审核。'
          + '不用登录的网页给 url；要他登录的（招聘网站的消息页）给 Mac 的 nodeId 和那个标签的 tabId。默认 30 分钟看一次、'
          + `盯 24 小时，最密 ${WATCH_MIN_MINUTES} 分钟。不用问他；他在「在做」里看得到、能关。不用了用 watch_stop。`,
        parameters: WatchParameters,
        execute: async (callId: string, input: unknown) => {
          const args = checkedArgs(WatchParameters, input, 'watch_start');
          const tab = args.nodeId !== undefined && args.tabId !== undefined ? { nodeId: args.nodeId, tabId: args.tabId }
            : null;
          const halfTab = (args.nodeId === undefined) !== (args.tabId === undefined);
          if ((args.url === undefined) === (tab === null) || halfTab) {
            throw new Error('url 和 nodeId + tabId 给一样。');
          }
          const { watches } = this.#deps.state.lineTimers;
          const callKey = `${scope.lineId}:${callId}`;
          if (watches.forLine(scope.lineId).length >= WATCH_PER_LINE_MAX && watches.byCall(callKey) === undefined) {
            throw new Error(`这条线已经盯着 ${WATCH_PER_LINE_MAX} 处了：先 watch_stop 不用的。`);
          }
          const hours = args.hours ?? WATCH_DEFAULT_HOURS;
          const watch = watches.add({ lineId: scope.lineId, callKey, title: args.title, url: args.url ?? null, tab,
            lookFor: args.lookFor ?? null, everyMinutes: args.everyMinutes ?? WATCH_DEFAULT_MINUTES,
            untilAt: new Date(this.#deps.now().getTime() + hours * 60 * MINUTE_MS).toISOString() });
          this.#deps.changed();
          this.#arm();
          return json({ id: watch.id, everyMinutes: watch.everyMinutes, untilAt: watch.untilAt,
            note: '马上看第一次记下现在的样子，之后变了会往这条线里说一句；这一轮可以先结束。' });
        },
      }),
    };
  }

  #stopTool(): KernelTool {
    return {
      name: 'watch_stop',
      say: () => '不再盯着',
      hardLine: () => null,
      create: () => ({
        name: 'watch_stop', label: '不再盯着',
        description: '停下一处盯着的（watch_start 回的 id），或撤掉一个还没到点的回来看（line_wake_later 回的 id）。',
        parameters: StopParameters,
        execute: async (_callId: string, input: unknown) => {
          const args = checkedArgs(StopParameters, input, 'watch_stop');
          this.cancel(args.id);
          return json({ stopped: args.id });
        },
      }),
    };
  }
}
