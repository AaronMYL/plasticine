// tasks/：任务栏目（《优化清单》第 3、4、5 条，用户 11-06 定，11-07 补）——定时线（到点替他做一件事）、照卡发送、建议、
// 「定时」列表的登记（订阅、回顾、做梦、心跳登记进来）和队友。线本身归 lines/：定时线就是一条后台线，到点放一条消息进去。
// 外面只经这里：assemble 装好 Tasks、把工具交给内核、把一轮停下接到 ended；app/ 拿它挂接口。

import type { KernelTool } from '../lines/index.ts';
import type { AskToolHost } from '../lines/index.ts';
import type { StateService } from '../state/index.ts';
import { scheduleProvider } from './schedule-rows.ts';
import { ScheduleDesk, type ScheduleLines, type ScheduleNotice } from './schedules.ts';
import { SuggestionDesk, type SuggestionLines } from './suggestions.ts';
import { TimedRegistry } from './timed.ts';
import { scheduleProposeTool, taskTools } from './tools.ts';

export { cadenceLabel, coveredBy, latestDue, missedDue, nextAfterRun, nextRun, rezonedNext, zonedClock }
  from './cadence.ts';
export { outcomeOf as lineOutcome, ScheduleDesk, ScheduleError, SCHEDULE_TICK_MS } from './schedules.ts';
export type { ScheduleLines, ScheduleNotice } from './schedules.ts';
export { SuggestionDesk } from './suggestions.ts';
export type { SuggestionInputDraft, SuggestionLines } from './suggestions.ts';
export { teammatesFromRows, TimedRegistry } from './timed.ts';
export type { TeammateLook, TimedProvider } from './timed.ts';
export { scheduleCard, scheduleRow } from './schedule-rows.ts';
export { shortNote, slotLast } from './slot-rows.ts';
export { SCHEDULE_CARD_CONTEXT_KEY } from './tools.ts';
export { scheduleTimeZone } from './time-zone.ts';
export { contentAllowed, siteAllowed } from './schedule-text.ts';
export { grantSend, PermitRefused } from './send-permit.ts';

export interface TasksOptions {
  state: StateService;
  now: () => Date;
  /** 定时线：后台线，不贴回哪条线（结果按卡上写的告诉他）。 */
  scheduleLines: () => ScheduleLines;
  /** 建议开始做：后台线，做完贴回主线。 */
  suggestionLines: () => SuggestionLines;
  notify?: (notice: ScheduleNotice) => void;
  /** 任务栏目变了（定时、建议），界面重读。 */
  changed?: () => void;
  projectChanged?: (projectId: string) => void;
}

export class Tasks {
  readonly schedules: ScheduleDesk;
  readonly suggestions: SuggestionDesk;
  readonly timed = new TimedRegistry();
  readonly #state: StateService;

  constructor(options: TasksOptions) {
    this.#state = options.state;
    this.schedules = new ScheduleDesk({ state: options.state, now: options.now, lines: options.scheduleLines,
      ...(options.notify === undefined ? {} : { notify: options.notify }),
      ...(options.changed === undefined ? {} : { changed: options.changed }),
      afterTick: (now) => this.timed.tick(now) });
    this.suggestions = new SuggestionDesk({ state: options.state, lines: options.suggestionLines,
      ...(options.changed === undefined ? {} : { changed: options.changed }),
      ...(options.projectChanged === undefined ? {} : { projectChanged: options.projectChanged }) });
    this.timed.register(scheduleProvider(options.state, this.schedules, options.scheduleLines));
  }

  start(): void {
    this.schedules.start();
  }

  stop(): void {
    this.schedules.stop();
  }

  /** 一条线这一轮停下（lines/ 的 turnEnded）：是定时线就记上次结果。 */
  ended(lineId: string): void {
    this.schedules.ended(lineId);
    this.timed.ended(lineId);
  }

  /** 给内核的工具：看 / 停开定时任务、照卡放行、提建议。 */
  tools(): KernelTool[] {
    return taskTools({ state: this.#state, schedules: this.schedules, suggestions: this.suggestions });
  }

  /** 要出卡等他答的：起草定时卡。 */
  askTools(): ((host: AskToolHost) => KernelTool)[] {
    return [scheduleProposeTool({ state: this.#state, schedules: this.schedules, suggestions: this.suggestions })];
  }
}
