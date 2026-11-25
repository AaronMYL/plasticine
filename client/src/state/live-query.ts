import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { errorText } from '../api/errors.ts';
import type { LiveEvent } from '../api/types.ts';

export const RELOAD_DELAY_MS = 400;
export const WARM_MS = 10 * 60_000;

export interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export type ReloadOn = ReadonlySet<LiveEvent['type']> | ((event: LiveEvent) => boolean);

interface Entry {
  state: QueryState<unknown>;
  fetch: (signal: AbortSignal) => Promise<unknown>;
  reloadOn: ReloadOn;
  listeners: Set<() => void>;
  lastUsed: number;
  stale: boolean;
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
  json: string | null;
}

const ALL = new Set<LiveQueries>();

export function invalidateQueries(match: (key: string) => boolean): void {
  for (const queries of ALL) queries.invalidate(match);
}

export interface EventSource {
  on(listener: (event: LiveEvent) => void): () => void;
}

export class LiveQueries {
  readonly #entries = new Map<string, Entry>();
  readonly #now: () => number;
  readonly #delayMs: number;

  constructor(hub: EventSource, options: { now?: () => number; delayMs?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#delayMs = options.delayMs ?? RELOAD_DELAY_MS;
    hub.on((event) => this.#onEvent(event));
    ALL.add(this);
  }

  register(key: string, fetch: Entry['fetch'], reloadOn: ReloadOn): QueryState<unknown> {
    const entry = this.#entries.get(key);
    if (entry !== undefined) {
      entry.fetch = fetch;
      entry.reloadOn = reloadOn;
      return entry.state;
    }
    const created: Entry = { state: { data: null, error: null, loading: true }, fetch, reloadOn, listeners: new Set(),
      lastUsed: this.#now(), stale: true, controller: null, timer: null, json: null };
    this.#entries.set(key, created);
    return created.state;
  }

  get(key: string): QueryState<unknown> | undefined {
    return this.#entries.get(key)?.state;
  }

  subscribe(key: string, listener: () => void): () => void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return () => {};
    entry.listeners.add(listener);
    entry.lastUsed = this.#now();
    return () => {
      entry.listeners.delete(listener);
      entry.lastUsed = this.#now();
    };
  }

  ensure(key: string): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    entry.lastUsed = this.#now();
    if (entry.stale && entry.controller === null) {
      void this.#load(key, entry);
    }
  }

  reload(key: string): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    entry.stale = true;
    entry.controller?.abort();
    entry.controller = null;
    void this.#load(key, entry);
  }

  invalidate(match: (key: string) => boolean): void {
    for (const [key, entry] of this.#entries) {
      if (match(key)) this.#markStale(key, entry);
    }
  }

  #onEvent(event: LiveEvent): void {
    for (const [key, entry] of this.#entries) {
      if (event.type === 'resync' || matches(entry.reloadOn, event)) this.#markStale(key, entry);
    }
  }

  #markStale(key: string, entry: Entry): void {
    entry.stale = true;
    const warm = entry.listeners.size > 0 || this.#now() - entry.lastUsed < WARM_MS;
    if (!warm) return;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.stale) {
        entry.controller?.abort();
        entry.controller = null;
        void this.#load(key, entry);
      }
    }, this.#delayMs);
  }

  async #load(key: string, entry: Entry): Promise<void> {
    const controller = new AbortController();
    entry.controller = controller;
    entry.stale = false;
    if (entry.state.data === null && !entry.state.loading) {
      this.#set(entry, { ...entry.state, loading: true });
    }
    try {
      const data = await entry.fetch(controller.signal);
      if (controller.signal.aborted || this.#entries.get(key) !== entry) return;
      entry.controller = null;
      const json = safeJson(data);
      if (json !== null && json === entry.json && entry.state.error === null) {
        if (entry.state.loading) this.#set(entry, { ...entry.state, loading: false });
        return;
      }
      entry.json = json;
      this.#set(entry, { data, error: null, loading: false });
    } catch (cause) {
      if (controller.signal.aborted || this.#entries.get(key) !== entry) return;
      entry.controller = null;
      entry.stale = true;
      this.#set(entry, { data: entry.state.data, error: errorText(cause), loading: false });
    }
  }

  #set(entry: Entry, state: QueryState<unknown>): void {
    entry.state = state;
    for (const listener of [...entry.listeners]) listener();
  }
}

function matches(reloadOn: ReloadOn, event: LiveEvent): boolean {
  return typeof reloadOn === 'function' ? reloadOn(event) : reloadOn.has(event.type);
}

function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

const NO_QUERY: QueryState<never> = { data: null, error: null, loading: false };

export interface LiveQuery<T> extends QueryState<T> {
  reload: () => void;
}

export function useLiveQuery<T>(queries: LiveQueries, key: string | null,
  fetch: (signal: AbortSignal) => Promise<T>, reloadOn: ReloadOn): LiveQuery<T> {
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;
  const stableFetch = useCallback((signal: AbortSignal) => fetchRef.current(signal), []);
  if (key !== null) {
    queries.register(key, stableFetch, reloadOn);
  }
  const subscribe = useCallback((listener: () => void) => (key === null ? () => {}
    : queries.subscribe(key, listener)), [queries, key]);
  const getSnapshot = useCallback(() => (key === null ? NO_QUERY : queries.get(key) ?? NO_QUERY), [queries, key]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot) as QueryState<T>;
  useEffect(() => {
    if (key !== null) queries.ensure(key);
  }, [queries, key]);
  const reload = useCallback(() => {
    if (key !== null) queries.reload(key);
  }, [queries, key]);
  return useMemo(() => ({ ...state, reload }), [state, reload]);
}

const BY_HUB = new WeakMap<EventSource, LiveQueries>();

export function queriesFor(hub: EventSource): LiveQueries {
  let queries = BY_HUB.get(hub);
  if (queries === undefined) {
    queries = new LiveQueries(hub);
    BY_HUB.set(hub, queries);
  }
  return queries;
}
