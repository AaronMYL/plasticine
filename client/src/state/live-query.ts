// 页面数据的共用缓存（第 11 批第一步「切页不闪」）。以前每页自己 useState + useEffect 去读，离开就丢，回来先出「正在读…」
// 再换成内容。现在按 key 存一份：
// - 回到读过的页面，直接画手里这份；服务端的事件（tasks.changed、space.changed……）一到就在后台重读，人不在页面上也读，
//   所以手里这份一直是新的，不会「先出旧的再刷新」。
// - 事件流断过（resync）就把所有份标成旧的；用到的时候重读，最近用过的当场在后台重读。
// - 读回来的和手里的一样（按 JSON 比）就不换，组件不重画。
// - 很久没用（WARM_MS）的份，事件来了只标旧，不在后台读。

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { errorText } from '../api/errors.ts';
import type { LiveEvent } from '../api/types.ts';

/** 事件之后隔多久再读：一串连着来的只读一次（和任务栏目原来的 400ms 一样）。 */
export const RELOAD_DELAY_MS = 400;
/** 离开页面后多久之内，事件来了照样在后台重读。 */
export const WARM_MS = 10 * 60_000;

export interface QueryState<T> {
  data: T | null;
  error: string | null;
  /** 正在读，而且手里还没有一份（只在这时画占位）。 */
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
  /** 上一份的 JSON，用来判断读回来的有没有变。 */
  json: string | null;
}

const ALL = new Set<LiveQueries>();

/** 本机写过、服务端不发事件的数据：让所有缓存里匹配的那几份标旧（见 LiveQueries.invalidate）。 */
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

  /** 登记（或更新）一份的读法。返回当前状态。 */
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

  /** 页面打开时调：没有或旧了才读。 */
  ensure(key: string): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    entry.lastUsed = this.#now();
    if (entry.stale && entry.controller === null) {
      void this.#load(key, entry);
    }
  }

  /** 写操作之后、人点「重试」时：马上重读（手里那份先留着）。 */
  reload(key: string): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    entry.stale = true;
    entry.controller?.abort();
    entry.controller = null;
    void this.#load(key, entry);
  }

  /** 本机改了东西、服务端不发事件的（资料库改名、删除）：按 key 标旧，最近用过的在后台重读。 */
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

/**
 * 页面读数据：key 是这份数据的名字（同 key 的页面共用一份），fetch 是怎么读，reloadOn 是哪些事件之后要重读。
 * key 为 null 时不读（比如还没选中东西）。
 */
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

/** 每条事件流一份缓存（登录失效、整层重建时跟着换新）。 */
export function queriesFor(hub: EventSource): LiveQueries {
  let queries = BY_HUB.get(hub);
  if (queries === undefined) {
    queries = new LiveQueries(hub);
    BY_HUB.set(hub, queries);
  }
  return queries;
}
