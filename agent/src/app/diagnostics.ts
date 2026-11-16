// 服务自己的体检（11-16）：19:02–19:17 服务卡住，上游失败 754 次，日志里只有「请求处理失败 / UnknownError」，
// 查不到是哪条请求、哪次查询堵住。现在每个请求记路由模板（不带 id 和正文）、状态、耗时；慢的（超过 500 毫秒）和出错的
// 写进日志，出错带错误原文和位置（日志工具会洗掉像凭据的东西）；慢查询记语句开头和耗时；事件循环延迟每分钟记一次。
// 最近这些在内存里留一段，server_health 工具按路由汇总给 AI 看。

import { monitorEventLoopDelay } from 'node:perf_hooks';

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;
import { failureText } from '../util/index.ts';

export const SLOW_REQUEST_MS = 500;
/** 事件循环这一分钟的 p99 超过这么多毫秒就写日志。 */
const LAG_LOG_MS = 200;
const REQUESTS_KEPT = 5_000;
const ERRORS_KEPT = 200;
const SQL_KEPT = 200;
const LAG_KEPT = 240;
const MINUTE_MS = 60_000;

export interface RequestMark {
  at: number;
  route: string;
  method: string;
  status: number;
  ms: number;
}

export interface ErrorMark {
  at: number;
  route: string;
  method: string;
  status: number;
  error: string;
  where: string | null;
}

export interface LagMark {
  at: number;
  p99Ms: number;
  maxMs: number;
}

function push<T>(list: T[], item: T, keep: number): void {
  list.push(item);
  if (list.length > keep) {
    list.splice(0, list.length - keep);
  }
}

/** 出错位置：栈里第一行我们自己的代码（agent/、client/ 下的文件和行号）。 */
export function whereOf(error: unknown): string | null {
  if (!(error instanceof Error) || error.stack === undefined) {
    return null;
  }
  for (const line of error.stack.split('\n').slice(1)) {
    const match = /((?:agent|client|scripts)\/[^\s:()]+:\d+)/.exec(line);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}

export class Diagnostics {
  readonly #requests: RequestMark[] = [];
  readonly #errors: ErrorMark[] = [];
  readonly #sql: { at: number; sql: string; ms: number }[] = [];
  readonly #lag: LagMark[] = [];
  readonly #now: () => number;
  #histogram: IntervalHistogram | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #onLag: ((mark: LagMark) => void) | null = null;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  request(route: string, method: string, status: number, ms: number): void {
    push(this.#requests, { at: this.#now(), route, method, status, ms }, REQUESTS_KEPT);
  }

  error(route: string, method: string, status: number, error: unknown): void {
    push(this.#errors, { at: this.#now(), route, method, status, error: failureText(error).slice(0, 300),
      where: whereOf(error) }, ERRORS_KEPT);
  }

  sql(sql: string, ms: number): void {
    push(this.#sql, { at: this.#now(), sql: sql.replace(/\s+/g, ' ').trim().slice(0, 160), ms }, SQL_KEPT);
  }

  /** 每分钟量一次事件循环延迟；高的交给 onLag 记日志。 */
  start(onLag: (mark: LagMark) => void): void {
    if (this.#timer !== null) {
      return;
    }
    this.#onLag = onLag;
    this.#histogram = monitorEventLoopDelay({ resolution: 20 });
    this.#histogram.enable();
    this.#timer = setInterval(() => this.#sample(), MINUTE_MS);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
    }
    this.#histogram?.disable();
    this.#timer = null;
    this.#histogram = null;
  }

  #sample(): void {
    const histogram = this.#histogram;
    if (histogram === null) {
      return;
    }
    const mark = { at: this.#now(), p99Ms: Math.round(histogram.percentile(99) / 1e6),
      maxMs: Math.round(histogram.max / 1e6) };
    histogram.reset();
    push(this.#lag, mark, LAG_KEPT);
    if (mark.p99Ms >= LAG_LOG_MS) {
      this.#onLag?.(mark);
    }
  }

  /** 最近 minutes 分钟：按路由汇总（次数、出错、p95、最慢、总耗时），出错的、慢查询、事件循环延迟。 */
  snapshot(minutes: number) {
    const since = this.#now() - minutes * MINUTE_MS;
    const byRoute = new Map<string, number[]>();
    const failed = new Map<string, number>();
    for (const mark of this.#requests) {
      if (mark.at < since) {
        continue;
      }
      const key = `${mark.method} ${mark.route}`;
      byRoute.set(key, [...(byRoute.get(key) ?? []), mark.ms]);
      if (mark.status >= 500) {
        failed.set(key, (failed.get(key) ?? 0) + 1);
      }
    }
    const routes = [...byRoute.entries()].map(([route, times]) => {
      const sorted = [...times].sort((a, b) => a - b);
      return { route, count: sorted.length, failed: failed.get(route) ?? 0,
        p95Ms: Math.round(sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0),
        maxMs: Math.round(sorted.at(-1) ?? 0), totalMs: Math.round(sorted.reduce((sum, ms) => sum + ms, 0)) };
    }).sort((a, b) => b.totalMs - a.totalMs).slice(0, 20);
    const time = (at: number): string => new Date(at).toISOString();
    return {
      routes,
      errors: this.#errors.filter((mark) => mark.at >= since).slice(-20)
        .map((mark) => ({ ...mark, at: time(mark.at) })),
      slowQueries: this.#sql.filter((mark) => mark.at >= since).slice(-20)
        .map((mark) => ({ ...mark, at: time(mark.at), ms: Math.round(mark.ms) })),
      eventLoop: this.#lag.filter((mark) => mark.at >= since).map((mark) => ({ ...mark, at: time(mark.at) })),
    };
  }
}
