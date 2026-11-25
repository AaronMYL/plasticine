import {
  TRANSLATE_MODEL_TIMEOUT_MS, TRANSLATE_PRIORITIES, type TranslatePriority, type TranslateRequest,
  type TranslateResponse,
} from '../../shared/api/translate.ts';
import type { TextModels } from '../kernel/index.ts';
import type { TranslationCache } from '../state/index.ts';
import {
  failureOf, glossaryHash, incomplete, normalizeSource, outputBudget, parseOutput, sha256, systemPrompt, termsIn,
  timedOut, userMessage, type FailureText, type GlossaryTerm,
} from './translate-prompt.ts';

export type { GlossaryTerm } from './translate-prompt.ts';

export const TRANSLATE_CONCURRENCY = 3;
export const TRANSLATE_TIMEOUT_MS = TRANSLATE_MODEL_TIMEOUT_MS;

export interface PageTranslatorDeps {
  models: TextModels;
  cache: TranslationCache;
  modelName: () => string;
  glossary: () => readonly GlossaryTerm[];
  now?: () => Date;
  concurrency?: number;
}

export interface PageTranslateInput extends TranslateRequest {
  glossary: boolean;
  timeZone: string;
}

interface Prepared {
  id: string;
  text: string;
  chars: number;
  terms: GlossaryTerm[];
  key: { sourceHash: string; target: TranslateRequest['target']; model: string; glossaryHash: string };
}

export class PageTranslator {
  readonly #deps: PageTranslatorDeps;
  readonly #limit: number;
  #running = 0;
  readonly #waiting: Record<TranslatePriority, (() => void)[]> = { visible: [], ahead: [] };

  constructor(deps: PageTranslatorDeps) {
    this.#deps = deps;
    this.#limit = deps.concurrency ?? TRANSLATE_CONCURRENCY;
  }

  async translate(input: PageTranslateInput, signal: AbortSignal): Promise<TranslateResponse> {
    signal.throwIfAborted();
    const snapshot = this.#deps.models.snapshot?.('translation');
    const model = snapshot?.identity ?? this.#deps.modelName();
    const models = snapshot?.models ?? this.#deps.models;
    const glossary = input.glossary ? this.#deps.glossary() : [];
    const prepared: Prepared[] = input.items.map((item) => {
      const text = normalizeSource(item.text);
      const terms = termsIn(text, glossary);
      return { id: item.id, text, chars: [...text].length, terms,
        key: { sourceHash: sha256(text), target: input.target, model, glossaryHash: glossaryHash(terms) } };
    });
    const found = input.fresh === true ? new Map<string, string>()
      : this.#deps.cache.lookup(prepared.map((entry) => entry.key));
    const items: TranslateResponse['items'] = [];
    const misses: Prepared[] = [];
    for (const entry of prepared) {
      const hit = found.get(this.#deps.cache.keyOf(entry.key));
      if (hit === undefined) {
        misses.push(entry);
      } else {
        items.push({ id: entry.id, text: hit, cached: true });
      }
    }
    let failure: FailureText | null = null;
    let failedIds: string[] = [];
    if (misses.length > 0) {
      const outcome = await this.#queued(input.priority, signal,
        () => this.#ask(input, misses, signal, models));
      items.push(...outcome.items);
      failure = outcome.failure;
      failedIds = outcome.failedIds;
    }
    const order = new Map(input.items.map((item, index) => [item.id, index]));
    items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return { model, items, failure: failure === null ? null : { ...failure, ids: failedIds } };
  }

  async #ask(input: PageTranslateInput, misses: Prepared[], signal: AbortSignal, models: TextModels): Promise<{
    items: TranslateResponse['items']; failure: FailureText | null; failedIds: string[] }> {
    const terms = [...new Map(misses.flatMap((entry) => entry.terms).map((term) => [term.term, term])).values()];
    const chars = misses.reduce((sum, entry) => sum + entry.chars, 0);
    const timeout = AbortSignal.timeout(TRANSLATE_TIMEOUT_MS);
    const requestSignal = AbortSignal.any([signal, timeout]);
    const now = this.#deps.now?.() ?? new Date();
    const fail = (text: FailureText) => ({ items: [], failure: text, failedIds: misses.map((entry) => entry.id) });
    let answer;
    try {
      answer = await models.ask({ system: systemPrompt(input.target, terms),
        messages: [{ role: 'user', content: userMessage(input.target, misses) }], purpose: 'translation',
        maxOutputTokens: outputBudget(chars) }, requestSignal);
    } catch (cause) {
      signal.throwIfAborted();
      return fail(timeout.aborted ? timedOut() : failureOf(cause, input.timeZone, now));
    }
    const parsed = answer.complete ? parseOutput(answer.text) : null;
    if (parsed === null) {
      return fail(incomplete());
    }
    const translated = misses.filter((entry) => parsed.has(entry.id));
    this.#deps.cache.store(translated.map((entry) => ({ ...entry.key, text: parsed.get(entry.id)!,
      sourceChars: entry.chars })));
    const failedIds = misses.filter((entry) => !parsed.has(entry.id)).map((entry) => entry.id);
    return {
      items: translated.map((entry) => ({ id: entry.id, text: parsed.get(entry.id)!, cached: false })),
      failure: failedIds.length === 0 ? null : incomplete(),
      failedIds,
    };
  }

  async #queued<T>(priority: TranslatePriority, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#limit) {
      await new Promise<void>((resolve, reject) => {
        const lane = this.#waiting[priority];
        const start = (): void => {
          signal.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = (): void => {
          lane.splice(lane.indexOf(start), 1);
          reject(signal.reason);
        };
        lane.push(start);
        signal.addEventListener('abort', cancel, { once: true });
      });
    }
    this.#running += 1;
    try {
      return await work();
    } finally {
      this.#running -= 1;
      const next = TRANSLATE_PRIORITIES.map((lane) => this.#waiting[lane]).find((lane) => lane.length > 0)?.shift();
      next?.();
    }
  }
}
