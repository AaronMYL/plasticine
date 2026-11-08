// 消息里互动部件的作答（2026-11-03 shell3）：点了先在本机显示答案（发出去的那一刻起），服务端回执到了以回执里的
// 部件为准（ConversationStore.adopt），之后本机这一份就拿掉。没送到就退回原样并写一句原因；结果待核实时再点
// 同一个答案用同一个 requestId 重发，服务端不会重做。「改」（选项、输入框）只是在本机重新摆出选项，再答一次才发。
// 键是「消息 id · 部件 id」。

import { createRequestId } from '../api/request-id.ts';
import type { MessageWidgetAnswer } from '../api/shared.ts';
import { Store } from './store.ts';

export interface WidgetAnswerState {
  /** 已发出、回执还没到的答案（先按它显示）。 */
  sending: MessageWidgetAnswer | null;
  /** 点了「改」：不看消息里的答案，重新摆出选项。 */
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
  /** 上一次发出的答案和它的 requestId：回执不确定后再点同一个答案时重用，服务端按它去重。 */
  private readonly lastRequest = new Map<string, { answer: string; requestId: string }>();

  get(key: string): WidgetAnswerState {
    return this.store.get().get(key) ?? IDLE;
  }

  /** 开始发一个答案：回这次用的 requestId。 */
  begin(key: string, answer: MessageWidgetAnswer): string {
    const text = JSON.stringify(answer);
    const previous = this.lastRequest.get(key);
    const requestId = previous?.answer === text ? previous.requestId : createRequestId();
    this.lastRequest.set(key, { answer: text, requestId });
    this.patch(key, { sending: answer, error: null });
    return requestId;
  }

  /** 回执到了：本机这一份拿掉，按消息里的部件显示。 */
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

  /** 改主意（选项、输入框）：重新摆出来，再答一次才发。 */
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
