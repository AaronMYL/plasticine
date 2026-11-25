import type { AskToolHost, KernelTool } from '../lines/index.ts';
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
  scheduleLines: () => ScheduleLines;
  suggestionLines: () => SuggestionLines;
  notify?: (notice: ScheduleNotice) => void;
  changed?: () => void;
  projectChanged?: (projectId: string) => void;
  ready?: () => boolean;
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
      ...(options.ready === undefined ? {} : { ready: options.ready }),
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

  ended(lineId: string): void {
    this.schedules.ended(lineId);
    this.timed.ended(lineId);
  }

  tools(): KernelTool[] {
    return taskTools({ state: this.#state, schedules: this.schedules, suggestions: this.suggestions });
  }

  askTools(): ((host: AskToolHost) => KernelTool)[] {
    return [scheduleProposeTool({ state: this.#state, schedules: this.schedules, suggestions: this.suggestions })];
  }
}
export { scheduleActor } from './schedule-owner.ts';
export type { ScheduleOwnerState } from './schedule-owner.ts';
