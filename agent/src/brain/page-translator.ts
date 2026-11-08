// 网页翻译（2026-11-03 沉浸式翻译，第 2 批）：一批网页段落 → 每段译文。模型调用只从脑发出（plasticine-code「目录与
// 边界」）；设备和界面只送段落、收译文。
// - 缓存：按（规整后原文的散列、目标语言、实际模型、这段用到的词表散列）查 state 的译文缓存，命中不调模型；重译（fresh）
//   不查缓存，译完覆盖。
// - 用词表：开着时只把这段里出现的词（按词的任一叫法匹配）带进提示；词表改了只影响用到那个词的段落。
// - 前台优先：模型接入层没有队列和优先级（每次调用直接流式发出，后台任务不会把这里排在后面）。网页翻译自己有一个小队列：
//   同时最多 TRANSLATE_CONCURRENCY 批在问模型，他正看着的（visible）先于往下一屏的预取（ahead）。
// - 出错：额度用完、订阅掉线这类回一句中文原因和什么时候能再试（translate-prompt.ts failureOf），缓存命中的照样回。

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

/** 同时在问模型的翻译批数：三批够一屏，再多是在和对话抢订阅的并发。 */
export const TRANSLATE_CONCURRENCY = 3;
/** 一批最多等模型这么久：和客户端共用一份（shared/api/translate.ts），客户端的请求时限比它长。 */
export const TRANSLATE_TIMEOUT_MS = TRANSLATE_MODEL_TIMEOUT_MS;

export interface PageTranslatorDeps {
  models: TextModels;
  cache: TranslationCache;
  /** 每批读一次现在用的模型（缓存按模型分开）：设置 · AI 里换了模型，下一批就用新的、不吃旧模型的译文。 */
  modelName: () => string;
  /** 记忆里在用的词表。 */
  glossary: () => readonly GlossaryTerm[];
  now?: () => Date;
  concurrency?: number;
}

export interface PageTranslateInput extends TranslateRequest {
  glossary: boolean;
  /** 「几点能再试」按他的时区写。 */
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

  /** 排队：位置满了就等；放行时先放 visible，再放 ahead。取消的从队里拿掉。 */
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
