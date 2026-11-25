import type { HubStreamEvent } from '../../shared/api/index.ts';

type Delta = Extract<HubStreamEvent, { type: 'line_text' }>;
const BOUNDARY = /[\s<>"'`\\，。；（）【】]/g;

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
