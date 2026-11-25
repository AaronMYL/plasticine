import { Value } from 'typebox/value';
import type { TranslateApi } from '../api/client.ts';
import { errorText } from '../api/errors.ts';
import {
  siteListed, TranslateEventSchema, translateSiteOf, type PlasticineMacTranslate, type TranslateDisplay,
  type TranslateEvent, type TranslateSettingsView, type TranslateTarget,
} from '../api/shared.ts';
import { Store } from '../state/store.ts';
import type { Telemetry } from '../telemetry.ts';

export const TRANSLATE_CONCURRENCY = 3;
const RETRY_LIMIT = 2;
const RETRY_DELAY_MS = 2_000;

export type TranslateStatus = 'off' | 'on' | 'running' | 'error' | 'blocked';

export interface TabTranslation {
  status: TranslateStatus;
  run: string | null;
  url: string;
  blocked: boolean;
  reason: string | null;
  chars: number;
  pending: number;
  done: number;
  failed: number;
  cachedChars: number;
  firstScreenMs: number | null;
}

const OFF: TabTranslation = { status: 'off', run: null, url: '', blocked: false, reason: null, chars: 0, pending: 0,
  done: 0,
  failed: 0, cachedChars: 0, firstScreenMs: null };

type RequestEvent = Extract<TranslateEvent, { type: 'request' }>;

interface Job {
  event: RequestEvent;
  attempt: number;
}

interface Round {
  run: string;
  controller: AbortController;
}

interface Flight {
  tabId: string;
  run: string;
}

export interface WebTranslatorDeps {
  api: TranslateApi;
  bridge: PlasticineMacTranslate;
  telemetry: Telemetry;
  ask: (quote: { url: string; title: string; source: string; translation: string }) => void;
  schedule?: (callback: () => void, ms: number) => void;
  newRun?: () => string;
}

function randomRun(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class WebTranslator {
  readonly tabs = new Store<Readonly<Record<string, TabTranslation>>>({});
  readonly settings = new Store<TranslateSettingsView | null>(null);
  readonly model = new Store<string | null>(null);
  readonly #deps: WebTranslatorDeps;
  readonly #queue: Record<'visible' | 'ahead', Job[]> = { visible: [], ahead: [] };
  readonly #rounds = new Map<string, Round>();
  readonly #flights = new Set<Flight>();

  constructor(deps: WebTranslatorDeps) {
    this.#deps = deps;
  }

  async refresh(signal?: AbortSignal): Promise<void> {
    const [settings, model] = await Promise.all([this.#deps.api.settings(signal),
      this.#deps.api.model(signal).catch((cause: unknown) => {
        console.warn('网页翻译的模型档位没读到，菜单里先不写模型', cause);
        return null;
      })]);
    this.settings.set(settings);
    const effective = model?.effective ?? null;
    this.model.set(effective === null ? null : `${effective.model} · ${effective.thinking}`);
  }

  state(tabId: string): TabTranslation {
    return this.tabs.get()[tabId] ?? OFF;
  }

  #patch(tabId: string, change: Partial<TabTranslation>): void {
    this.tabs.set((all) => ({ ...all, [tabId]: { ...(all[tabId] ?? OFF), ...change } }));
  }

  #config(run: string) {
    const settings = this.settings.get();
    return { run, target: settings?.target ?? 'zh-CN', display: settings?.display ?? 'bilingual' };
  }

  start(tabId: string, url: string): void {
    const current = this.state(tabId);
    if (current.blocked) {
      return;
    }
    this.#endRound(tabId);
    const run = (this.#deps.newRun ?? randomRun)();
    this.#rounds.set(tabId, { run, controller: new AbortController() });
    this.#patch(tabId, { ...OFF, status: 'running', run, url, blocked: false });
    this.#deps.bridge.configure(tabId, this.#config(run));
  }

  stop(tabId: string): void {
    const current = this.state(tabId);
    this.#endRound(tabId);
    this.#patch(tabId, { ...OFF, url: current.url, blocked: current.blocked,
      status: current.blocked ? 'blocked' : 'off' });
    this.#deps.bridge.configure(tabId, null);
  }

  retry(tabId: string): void {
    const run = this.state(tabId).run;
    if (run === null) {
      return;
    }
    this.#patch(tabId, { status: 'running', reason: null });
    this.#deps.bridge.configure(tabId, this.#config(run));
  }

  #endRound(tabId: string): void {
    this.#rounds.get(tabId)?.controller.abort();
    this.#rounds.delete(tabId);
    this.#forgetJobs(tabId);
    this.#pump();
  }

  #live(tabId: string, run: string): boolean {
    return this.#rounds.get(tabId)?.run === run;
  }

  toggle(tabId: string, url: string): void {
    const status = this.state(tabId).status;
    if (status === 'blocked') {
      return;
    }
    if (status === 'off') {
      this.start(tabId, url);
    } else {
      this.stop(tabId);
    }
  }

  async #save(change: (settings: TranslateSettingsView) => TranslateSettingsView): Promise<TranslateSettingsView> {
    const current = this.settings.get() ?? await this.#deps.api.settings();
    const saved = await this.#deps.api.saveSettings(change(current));
    this.settings.set(saved);
    return saved;
  }

  async setDisplay(display: TranslateDisplay): Promise<void> {
    await this.#save((settings) => ({ ...settings, display }));
    for (const [tabId, tab] of Object.entries(this.tabs.get())) {
      if (tab.run !== null) {
        this.#deps.bridge.configure(tabId, this.#config(tab.run));
      }
    }
  }

  async setTarget(target: TranslateTarget): Promise<void> {
    await this.#save((settings) => ({ ...settings, target }));
    for (const [tabId, tab] of Object.entries(this.tabs.get())) {
      if (tab.run !== null) {
        this.start(tabId, tab.url);
      }
    }
  }

  async setAlways(tabId: string, url: string, always: boolean): Promise<void> {
    const site = translateSiteOf(url);
    if (site === null) {
      return;
    }
    await this.#save((settings) => ({ ...settings, alwaysSites: always
      ? [...settings.alwaysSites.filter((entry) => entry !== site), site]
      : settings.alwaysSites.filter((entry) => !siteListed([entry], url)) }));
    if (always && this.state(tabId).status === 'off') {
      this.start(tabId, url);
    }
  }

  async never(url: string): Promise<void> {
    const site = translateSiteOf(url);
    if (site === null) {
      return;
    }
    if (siteListed(this.settings.get()?.alwaysSites ?? [], url)) {
      await this.#save((settings) => ({ ...settings,
        alwaysSites: settings.alwaysSites.filter((entry) => !siteListed([entry], url)) }));
    }
    for (const [tabId, tab] of Object.entries(this.tabs.get())) {
      if (tab.run !== null && translateSiteOf(tab.url) !== null && siteListed([site], tab.url)) {
        this.stop(tabId);
      }
    }
  }

  receive(raw: unknown): void {
    if (!Value.Check(TranslateEventSchema, raw)) {
      console.warn('Mac 原生层报来的翻译事件格式不对，没有用', raw);
      return;
    }
    const event = raw;
    switch (event.type) {
      case 'page':
        this.#page(event.tabId, event.url, event.blocked);
        return;
      case 'request':
        if (this.#live(event.tabId, event.run)) {
          this.#queue[event.priority].push({ event, attempt: 0 });
          this.#pump();
        }
        return;
      case 'progress':
        this.#progress(event);
        return;
      case 'ask':
        this.#deps.ask({ url: event.url, title: event.title, source: event.source, translation: event.translation });
        return;
    }
  }

  #page(tabId: string, url: string, blocked: boolean): void {
    const current = this.state(tabId);
    const sameSite = current.url !== '' && translateSiteOf(current.url) === translateSiteOf(url);
    const always = siteListed(this.settings.get()?.alwaysSites ?? [], url);
    if (blocked) {
      if (current.run !== null) {
        this.#endRound(tabId);
        this.#deps.bridge.configure(tabId, null);
      }
      this.#patch(tabId, { ...OFF, url, blocked: true, status: 'blocked' });
      return;
    }
    if (current.run !== null && !sameSite && !always) {
      this.stop(tabId);
      this.#patch(tabId, { url, blocked: false, status: 'off' });
      return;
    }
    this.#patch(tabId, { url, blocked: false, ...(current.status === 'blocked' ? { status: 'off' } : {}) });
    if (current.run === null && always) {
      this.start(tabId, url);
    }
  }

  #progress(event: Extract<TranslateEvent, { type: 'progress' }>): void {
    const tab = this.state(event.tabId);
    if (tab.run !== event.run) {
      return;
    }
    const settled = event.pending === 0 && this.#jobsFor(event.tabId) === 0;
    const status: TranslateStatus = event.failed > 0 ? 'error' : settled ? 'on' : 'running';
    this.#patch(event.tabId, { status, chars: event.chars, pending: event.pending, done: event.done,
      failed: event.failed,
      ...(status === 'on' ? { reason: null } : {}),
      ...(event.firstScreenMs === null ? {} : { firstScreenMs: event.firstScreenMs }) });
    if (event.firstScreenMs !== null && tab.firstScreenMs === null) {
      this.#deps.telemetry.track('translate.first_screen', { ms: event.firstScreenMs, chars: event.chars });
    }
    if (settled && tab.status === 'running') {
      this.#deps.telemetry.track('translate.page', { chars: event.chars, done: event.done, failed: event.failed,
        cachedChars: this.state(event.tabId).cachedChars });
    }
  }

  #jobsFor(tabId: string): number {
    return [...this.#queue.visible, ...this.#queue.ahead].filter((job) => job.event.tabId === tabId).length;
  }

  #forgetJobs(tabId: string): void {
    this.#queue.visible = this.#queue.visible.filter((job) => job.event.tabId !== tabId);
    this.#queue.ahead = this.#queue.ahead.filter((job) => job.event.tabId !== tabId);
  }

  #busy(): number {
    let count = 0;
    for (const flight of this.#flights) {
      if (this.#live(flight.tabId, flight.run)) {
        count += 1;
      }
    }
    return count;
  }

  #pump(): void {
    while (this.#busy() < TRANSLATE_CONCURRENCY) {
      const job = this.#queue.visible.shift() ?? this.#queue.ahead.shift();
      if (job === undefined) {
        return;
      }
      const flight: Flight = { tabId: job.event.tabId, run: job.event.run };
      this.#flights.add(flight);
      void this.#run(job).finally(() => {
        this.#flights.delete(flight);
        this.#pump();
      });
    }
  }

  async #run(job: Job): Promise<void> {
    const { event } = job;
    const round = this.#rounds.get(event.tabId);
    if (round === undefined || round.run !== event.run) {
      return;
    }
    const live = (): boolean => this.#rounds.get(event.tabId) === round;
    let failedIds: string[] = [];
    let reason: string | null = null;
    let retry = false;
    const body = { pageUrl: event.url, target: this.#config(event.run).target, priority: event.priority,
      items: event.items, ...(event.fresh ? { fresh: true } : {}) };
    try {
      const result = await this.#deps.api.translate(body, round.controller.signal);
      if (!live()) {
        return;
      }
      const cachedIds = new Set(result.items.filter((item) => item.cached).map((item) => item.id));
      const cachedChars = event.items.filter((item) => cachedIds.has(item.id))
        .reduce((sum, item) => sum + Array.from(item.text).length, 0);
      this.#patch(event.tabId, { cachedChars: this.state(event.tabId).cachedChars + cachedChars });
      if (result.items.length > 0) {
        this.#deps.bridge.deliver(event.tabId, { run: event.run, failed: [],
          items: result.items.map((item) => ({ id: item.id, text: item.text })) });
      }
      if (result.failure !== null) {
        failedIds = result.failure.ids;
        reason = result.failure.message;
        retry = result.failure.retryable && job.attempt < RETRY_LIMIT;
      }
    } catch (cause) {
      if (round.controller.signal.aborted) {
        return;
      }
      failedIds = event.items.map((item) => item.id);
      reason = errorText(cause);
      retry = job.attempt < RETRY_LIMIT;
    }
    if (failedIds.length === 0 || !live()) {
      return;
    }
    if (retry) {
      const again: Job = { event: { ...event, items: event.items.filter((item) => failedIds.includes(item.id)) },
        attempt: job.attempt + 1 };
      const schedule = this.#deps.schedule ?? ((callback, ms) => { setTimeout(callback, ms); });
      schedule(() => {
        if (live()) {
          this.#queue[event.priority].push(again);
          this.#pump();
        }
      }, RETRY_DELAY_MS);
      return;
    }
    this.#deps.bridge.deliver(event.tabId, { run: event.run, items: [], failed: failedIds });
    this.#patch(event.tabId, { status: 'error', reason });
  }
}
