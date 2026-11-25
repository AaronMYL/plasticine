import { createRequestId } from '../api/request-id.ts';
import type { MessageWidgetAnswer } from '../api/shared.ts';
import { Store } from './store.ts';

export interface WidgetAnswerState {
  sending: MessageWidgetAnswer | null;
  editing: boolean;
  error: string | null;
}

export type WidgetAnswers = ReadonlyMap<string, WidgetAnswerState>;

export function widgetKey(messageId: string, widgetId: string): string {
  return `${messageId}\u0000${widgetId}`;
}

const IDLE: WidgetAnswerState = { sending: null, editing: false, error: null };

export class WidgetAnswersStore {
  readonly store = new Store<WidgetAnswers>(new Map());
  private readonly lastRequest = new Map<string, { answer: string; requestId: string }>();

  get(key: string): WidgetAnswerState {
    return this.store.get().get(key) ?? IDLE;
  }

  begin(key: string, answer: MessageWidgetAnswer): string {
    const text = JSON.stringify(answer);
    const previous = this.lastRequest.get(key);
    const requestId = previous?.answer === text ? previous.requestId : createRequestId();
    this.lastRequest.set(key, { answer: text, requestId });
    this.patch(key, { sending: answer, error: null });
    return requestId;
  }

  settle(key: string): void {
    this.lastRequest.delete(key);
    this.patch(key, { sending: null, editing: false, error: null });
  }

  fail(key: string, error: string, keepRequest: boolean): void {
    if (!keepRequest) {
      this.lastRequest.delete(key);
    }
    this.patch(key, { sending: null, error });
  }

  edit(key: string): void {
    this.patch(key, { editing: true, error: null });
  }

  private patch(key: string, change: Partial<WidgetAnswerState>): void {
    this.store.set((previous) => {
      const next = new Map(previous);
      const merged = { ...(previous.get(key) ?? IDLE), ...change };
      if (merged.sending === null && !merged.editing && merged.error === null) {
        next.delete(key);
      } else {
        next.set(key, merged);
      }
      return next;
    });
  }
}
