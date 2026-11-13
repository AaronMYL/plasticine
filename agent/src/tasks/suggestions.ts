// 建议（《优化清单》第 4 条）：Plasticine 主动想到能帮他的事出一张建议卡，写清做什么、为什么现在做；他点了才开始，也能
// 忽略；能一键加成待办（项目待办）。推测不算他的决定，他点了才算：点的那一下记设备和时间。
// 统一的「提一条建议」入口是 suggest()：主对话的工具、以后的回顾和心跳都往这里放；同一个 key 不重复提。

import type { LineInputOrigin } from '../../shared/api/index.ts';
import { STANDING_PROJECT_IDS, type Suggestion, type SuggestionInput } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { ScheduleError } from './schedules.ts';
import { heldBack, recordSuggestion, settleSuggestion, suggestionTopic } from '../loop/suggestions.ts';

export type SuggestionState = Pick<StateService, 'suggestions' | 'projects' | 'transaction'>
  & Partial<Pick<StateService, 'loop'>>;

/** 开始做：开一条后台线，做完贴回主线（lines/ 的 LineKernel.open，assemble 接上）。 */
export interface SuggestionLines {
  open(input: { title: string; goal: string; projectId: string | null; origin: LineInputOrigin }): string;
}

export interface SuggestionDeskOptions {
  state: SuggestionState;
  lines: () => SuggestionLines;
  changed?: () => void;
  /** 加了待办：项目页重读。 */
  projectChanged?: (projectId: string) => void;
  now?: () => Date;
}

export type SuggestionInputDraft = Omit<SuggestionInput, 'projectId' | 'key' | 'sourceRef' | 'icon'>
  & Partial<Pick<SuggestionInput, 'projectId' | 'key' | 'sourceRef' | 'icon'>>
  /** 预测闭环（11-13）：这类建议的叫法；不给按来源和图标分。只记在闭环里，不进建议卡。 */
  & { topic?: string | undefined };

/** 出了卡（created）、认回同一张（没出新的）、或这一类他最近都忽略、先不出（held）。 */
export type SuggestResult = { suggestion: Suggestion; created: boolean; held?: undefined }
  | { suggestion: null; created: false; held: string };

export class SuggestionDesk {
  readonly #options: SuggestionDeskOptions;

  constructor(options: SuggestionDeskOptions) {
    this.#options = options;
  }

  /** 提一条建议。同一个 key 提过（不管他处理没处理）就认回那一张，不再出第二张。 */
  suggest(draft: SuggestionInputDraft): SuggestResult {
    const { state } = this.#options;
    const { topic: given, ...input } = draft;
    const key = input.key ?? null;
    const existing = key === null ? undefined : state.suggestions.byKey(key);
    if (existing !== undefined) {
      return { suggestion: existing, created: false };
    }
    const projectId = input.projectId ?? null;
    if (projectId !== null && state.projects.get(projectId) === undefined) {
      throw new ScheduleError('not_found', `没有这个项目：${projectId}。`);
    }
    const loop = state.loop === undefined ? undefined : { loop: state.loop };
    const topic = suggestionTopic({ topic: given, source: input.source, icon: input.icon });
    if (loop !== undefined && heldBack(loop, topic, this.#options.now?.() ?? new Date())) {
      return { suggestion: null, created: false, held: topic };
    }
    const suggestion = state.suggestions.create({ ...input, projectId, key, sourceRef: input.sourceRef ?? null,
      icon: input.icon ?? 'sparkle' });
    if (loop !== undefined) {
      recordSuggestion(loop, suggestion.id, topic, suggestion.title);
    }
    this.#options.changed?.();
    return { suggestion, created: true };
  }

  open(): Suggestion[] {
    return this.#options.state.suggestions.open();
  }

  /** 他点了「开始做」：开一条后台线去做，做完贴回主线。 */
  start(id: string, deviceId: string, at: string): { suggestion: Suggestion; lineId: string } {
    const suggestion = this.#openOne(id);
    const lineId = this.#options.lines().open({ title: suggestion.title, goal: this.#goal(suggestion),
      projectId: suggestion.projectId, origin: { kind: 'delegation', ref: `suggestion:${suggestion.id}` } });
    const started = this.#options.state.suggestions.update(suggestion.id, suggestion.version, { status: 'started',
      lineId, actedAt: at, actedByDeviceId: deviceId });
    this.#settle(suggestion.id, 'kept');
    this.#options.changed?.();
    return { suggestion: started, lineId };
  }

  /** 他点了「加成待办」：加进它的项目（没归项目的进「个人」）。 */
  toTodo(id: string, deviceId: string, at: string): { suggestion: Suggestion; projectId: string } {
    const { state } = this.#options;
    const suggestion = this.#openOne(id);
    const projectId = suggestion.projectId ?? STANDING_PROJECT_IDS.personal;
    const done = state.transaction(() => {
      const todo = state.projects.items.addTodo({ projectId, title: suggestion.title, due: null, addedBy: 'user',
        reason: '从建议加成待办' });
      return state.suggestions.update(suggestion.id, suggestion.version, { status: 'todo', todoId: todo.id,
        actedAt: at, actedByDeviceId: deviceId });
    });
    this.#settle(suggestion.id, 'kept');
    this.#options.changed?.();
    this.#options.projectChanged?.(projectId);
    return { suggestion: done, projectId };
  }

  /** 他点了「忽略」：收起来，同一件不再提。 */
  dismiss(id: string, deviceId: string, at: string): Suggestion {
    const suggestion = this.#openOne(id);
    const dismissed = this.#options.state.suggestions.update(suggestion.id, suggestion.version,
      { status: 'dismissed', actedAt: at, actedByDeviceId: deviceId });
    this.#settle(suggestion.id, 'rejected');
    this.#options.changed?.();
    return dismissed;
  }

  /** 预测闭环：他点了什么记进这张卡的那一条（没记过的旧卡不算）。 */
  #settle(id: string, outcome: 'kept' | 'rejected'): void {
    const loop = this.#options.state.loop;
    if (loop !== undefined) {
      settleSuggestion({ loop }, id, outcome);
    }
  }

  #openOne(id: string): Suggestion {
    const suggestion = this.#options.state.suggestions.get(id);
    if (suggestion === undefined) {
      throw new ScheduleError('not_found', '没有这条建议。');
    }
    if (suggestion.status !== 'open') {
      throw new ScheduleError('conflict', '这条建议已经处理过了。');
    }
    return suggestion;
  }

  #goal(suggestion: Suggestion): string {
    return `他在建议卡上点了「开始做」：${suggestion.title}。\n为什么现在做：${suggestion.why}\n要做的事：${suggestion.goal}`;
  }
}
