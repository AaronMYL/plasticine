export const OVERLAP_WINDOW = 120;
const WORD = /[A-Za-z0-9]/;
const LONE = /^[\p{P}\s]$/u;
const OPEN_QUOTE = /^["“「]/;
const CLOSE_QUOTE = /["”」]$/;

function joins(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && WORD.test(left) && WORD.test(right);
}

function boundaryOk(previous: string | undefined, overlap: string, next: string | undefined): boolean {
  if (overlap.length === 1) {
    return LONE.test(overlap);
  }
  return !joins(previous, overlap[0]) && !joins(overlap.at(-1), next);
}

export function leadingOverlap(before: string, text: string): number {
  const tail = before.slice(-OVERLAP_WINDOW);
  for (let length = Math.min(tail.length, text.length); length > 0; length -= 1) {
    const overlap = text.slice(0, length);
    if (tail.endsWith(overlap) && boundaryOk(before[before.length - length - 1], overlap, text[length])) {
      return length;
    }
  }
  return 0;
}

export function trailingOverlap(text: string, after: string): number {
  const head = after.replace(/^\s+/, '').slice(0, OVERLAP_WINDOW);
  for (let length = Math.min(head.length, text.length); length > 0; length -= 1) {
    const overlap = text.slice(text.length - length);
    if (head.startsWith(overlap) && boundaryOk(text[text.length - length - 1], overlap, head[length])) {
      return length;
    }
  }
  return 0;
}

export function overlapUndecided(before: string, start: string): boolean {
  const tail = before.slice(-OVERLAP_WINDOW);
  return start === '' || tail.slice(0, -1).includes(start);
}

function quoteLength(raw: string): number {
  return OPEN_QUOTE.test(raw) ? 1 : 0;
}

export class PredictText {
  readonly #before: string;
  readonly #after: string;
  #raw = '';
  #cut: number | null = null;
  #sent = 0;

  constructor(before: string, after: string) {
    this.#before = before;
    this.#after = after;
  }

  push(delta: string): string {
    this.#raw += delta;
    if (this.#cut === null) {
      const quote = quoteLength(this.#raw);
      const start = this.#raw.slice(quote);
      if (overlapUndecided(this.#before, start)) {
        return '';
      }
      this.#cut = quote + leadingOverlap(this.#before, start);
    }
    const text = this.#raw.slice(this.#cut);
    const fresh = text.slice(this.#sent);
    this.#sent = text.length;
    return fresh;
  }

  finish(raw: string): string {
    const decided = this.#cut !== null && raw.startsWith(this.#raw) ? this.#cut : null;
    const cut = decided ?? quoteLength(raw) + leadingOverlap(this.#before, raw.slice(quoteLength(raw)));
    const text = raw.slice(cut).trimEnd().replace(CLOSE_QUOTE, '');
    return text.slice(0, text.length - trailingOverlap(text, this.#after)).trimEnd();
  }
}
