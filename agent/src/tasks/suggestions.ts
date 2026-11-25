import type { LineInputOrigin } from '../../shared/api/index.ts';
import { STANDING_PROJECT_IDS, type Suggestion, type SuggestionInput } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { ScheduleError } from './schedules.ts';
import { heldBack, recordSuggestion, settleSuggestion, suggestionTopic } from '../loop/index.ts';

export type SuggestionState = Pick<StateService, 'suggestions' | 'projects' | 'transaction'>
  & Partial<Pick<StateService, 'loop'>>;

export interface SuggestionLines {
  open(input: { title: string; goal: string; projectId: string | null; origin: LineInputOrigin }): string;
}

export interface SuggestionDeskOptions {
  state: SuggestionState;
  lines: () => SuggestionLines;
  changed?: () => void;
  projectChanged?: (projectId: string) => void;
  now?: () => Date;
}

export type SuggestionInputDraft = Omit<SuggestionInput, 'projectId' | 'key' | 'sourceRef' | 'icon'>
  & Partial<Pick<SuggestionInput, 'projectId' | 'key' | 'sourceRef' | 'icon'>>
  & { topic?: string | undefined };

export type SuggestResult = { suggestion: Suggestion; created: boolean; held?: undefined }
  | { suggestion: null; created: false; held: string };

export class SuggestionDesk {
  readonly #options: SuggestionDeskOptions;

  constructor(options: SuggestionDeskOptions) {
    this.#options = options;
  }

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

  dismiss(id: string, deviceId: string, at: string): Suggestion {
    const suggestion = this.#openOne(id);
    const dismissed = this.#options.state.suggestions.update(suggestion.id, suggestion.version,
      { status: 'dismissed', actedAt: at, actedByDeviceId: deviceId });
    this.#settle(suggestion.id, 'rejected');
    this.#options.changed?.();
    return dismissed;
  }

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
