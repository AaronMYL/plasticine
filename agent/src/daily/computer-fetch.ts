import { randomUUID } from 'node:crypto';
import { COMPUTER_FETCH_JOBS_MAX, type ComputerFetchJob, type ComputerFetchReport } from
  '../../shared/api/feed-computer-fetch.ts';
import { DailyError } from './errors.ts';

export const COMPUTER_ONLINE_MS = 2 * 60_000;
const LEASE_MS = 2 * 60_000;
const KEPT_MS = 30 * 60_000;

export interface ComputerFetchPurpose {
  sourceId: string;
  discover: boolean;
}

interface Job {
  id: string;
  url: string;
  purpose: ComputerFetchPurpose;
  at: number;
  leasedAt: number | null;
}

export class ComputerFetches {
  readonly #now: () => Date;
  readonly #jobs = new Map<string, Job>();
  #seenAt = Number.NEGATIVE_INFINITY;

  constructor(now: () => Date) {
    this.#now = now;
  }

  online(): boolean {
    return this.#now().getTime() - this.#seenAt < COMPUTER_ONLINE_MS;
  }

  ask(url: string, purpose: ComputerFetchPurpose): boolean {
    this.#prune();
    if (!this.online()) { return false; }
    const queued = [...this.#jobs.values()].some((job) => job.purpose.sourceId === purpose.sourceId);
    if (!queued) {
      const id = `ff-${randomUUID()}`;
      this.#jobs.set(id, { id, url, purpose, at: this.#now().getTime(), leasedAt: null });
    }
    return true;
  }

  lease(): ComputerFetchJob[] {
    const now = this.#now().getTime();
    this.#seenAt = now;
    this.#prune();
    const jobs = [...this.#jobs.values()]
      .filter((job) => job.leasedAt === null || now - job.leasedAt > LEASE_MS)
      .slice(0, COMPUTER_FETCH_JOBS_MAX);
    for (const job of jobs) { job.leasedAt = now; }
    return jobs.map((job) => ({ id: job.id, url: job.url }));
  }

  take(jobId: string): { url: string; purpose: ComputerFetchPurpose } | undefined {
    const job = this.#jobs.get(jobId);
    this.#jobs.delete(jobId);
    return job === undefined ? undefined : { url: job.url, purpose: job.purpose };
  }

  #prune(): void {
    const now = this.#now().getTime();
    for (const [id, job] of this.#jobs) {
      if (now - job.at > KEPT_MS) { this.#jobs.delete(id); }
    }
  }
}

export function handOffText(kind: string, error: unknown): string | null {
  if (!(error instanceof DailyError)) { return null; }
  if (error.code === 'rate_limited') {
    return kind === 'reddit' ? 'Reddit 限流，已让在线的电脑去取' : '对方限流了，已让在线的电脑去取';
  }
  if (error.code !== 'unreachable' || error.message.includes('出错了')) { return null; }
  if (error.message.includes('超时')) { return '服务器等不到这个网站回应（超时），已让在线的电脑去取'; }
  if (error.message.includes('拒绝')) { return '这个网站拒绝了服务器的访问，已让在线的电脑去取'; }
  return '服务器连不上这个网站（连接被断开），已让在线的电脑去取';
}

export function computerFailureText(error: ComputerFetchReport['error'], kind = ''): string {
  if (error === null) { return '服务器和电脑都没取到'; }
  const known: Partial<Record<string, string>> = {
    http_error: `对方回了 ${String(error.status ?? '错误')}`,
    too_large: '正文超过 2 MB',
    refused: '电脑不替服务器取这种地址',
  };
  const why = known[error.code] ?? (error.detail?.trim() || '页面没打开');
  const hint = kind === 'reddit' && error.code === 'http_error' && error.status === 429
    ? '；在电脑上的 Plasticine 浏览器里登录 Reddit，电脑会带着登录去取' : '';
  return `服务器和电脑都没取到（${why}）${hint}`;
}
