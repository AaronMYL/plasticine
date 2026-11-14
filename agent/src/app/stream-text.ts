// 线的流式回答（line_text）里一个链接可能被切在两段增量之间：没闭合的那一截先留着，等到边界、或这条线有了别的事件
// （这一条写进库、开始一步、状态变了）再连同尾巴一起发，界面上链接不会半截闪一下。发布和补播走同一个出口。
// 11-14 起不再清洗链接（事件只给他自己的设备，自己用不清洗）。
import type { HubStreamEvent } from '../../shared/api/index.ts';

type Delta = Extract<HubStreamEvent, { type: 'line_text' }>;
const BOUNDARY = /[\s<>"'`\\，。；（）【】]/g;

/** 这个事件属于哪条线（线事件才有）；有尾巴的线在它别的事件之前先把尾巴发出去。 */
function lineOf(event: HubStreamEvent): string | null {
  if (event.type === 'line_message') {
    return event.message.lineId;
  }
  if (event.type === 'line_changed') {
    return event.line.id;
  }
  if (event.type === 'line_tool' || event.type === 'line_queue' || event.type === 'line_thinking') {
    return event.lineId;
  }
  return null;
}

export class StreamText {
  readonly #tails = new Map<string, Delta>();

  take(event: HubStreamEvent): HubStreamEvent[] {
    if (event.type === 'line_text') {
      const previous = this.#tails.get(event.lineId);
      const text = (previous?.delta ?? '') + event.delta;
      const boundary = [...text.matchAll(BOUNDARY)].at(-1);
      let end = boundary === undefined ? 0 : boundary.index + boundary[0].length;
      const suffix = text.slice(end);
      if (!suffix.includes('//')) {
        const possibleStart = /[a-z0-9+.:/-]+$/i.exec(suffix);
        end = text.length - (possibleStart?.[0].length ?? 0);
      }
      this.#tails.set(event.lineId, { ...event, delta: text.slice(end) });
      return [{ ...event, delta: text.slice(0, end) }];
    }
    const lineId = lineOf(event);
    return [...(lineId === null ? [] : this.#flush(lineId)), event];
  }

  #flush(lineId: string): Delta[] {
    const tail = this.#tails.get(lineId);
    this.#tails.delete(lineId);
    return tail === undefined || tail.delta === '' ? [] : [tail];
  }
}
