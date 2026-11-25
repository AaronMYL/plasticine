import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BrowserWindow, type Session } from 'electron';
import type { DouyinJob, DouyinReport, XhsReport, XTimelineReport } from '../../../agent/shared/api/index.ts';
import { DOUYIN_WORKS_PER_REPORT_MAX, X_POSTS_MAX } from '../../../agent/shared/api/index.ts';
import type { NodeApi } from '../node/node-api.ts';
import { readXPlaces, type XPage } from './x-places.ts';
import { readXhs } from './xhs-read.ts';
import { fetchForServer } from './fetch-for-server.ts';

const X_ASK_EVERY_MS = 10 * 60_000;
const DOUYIN_ASK_EVERY_MS = 60_000;
const FETCH_ASK_EVERY_MS = 30_000;
const FIRST_ASK_DELAY_MS = 90_000;
const LOAD_TIMEOUT_MS = 30_000;
const X_WORLD = 1_017;

export type PageScript = 'x-timeline' | 'douyin' | 'xhs';

export interface FeedDeps {
  session: Session;
  userAgent: string;
  node(): { api: NodeApi; credential: string } | null;
  pageScript(name: PageScript): string;
  log(line: string): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hiddenWindow(deps: FeedDeps): BrowserWindow {
  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
    session: deps.session, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  window.webContents.setUserAgent(deps.userAgent);
  window.webContents.setAudioMuted(true);
  return window;
}

async function loadIn(window: BrowserWindow, url: string): Promise<string | null> {
  try {
    await Promise.race([window.loadURL(url), sleep(LOAD_TIMEOUT_MS).then(() => {
      throw new Error('30 秒没载入完');
    })]);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function hiddenPage(deps: FeedDeps, url: string): Promise<{ window: BrowserWindow; problem: string | null }> {
  const window = hiddenWindow(deps);
  return { window, problem: await loadIn(window, url) };
}

export class FeedRunner {
  private readonly deps: FeedDeps;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private xRunning = false;
  private xhsRunning = false;
  private fetchRunning = false;
  private douyinRunning = false;

  constructor(deps: FeedDeps) {
    this.deps = deps;
  }

  start(): void {
    this.timers.push(setTimeout(() => {
      void this.x();
      void this.xhs();
      void this.fetches();
      void this.douyin();
      this.timers.push(setInterval(() => void this.x(), X_ASK_EVERY_MS));
      this.timers.push(setInterval(() => void this.xhs(), X_ASK_EVERY_MS));
      this.timers.push(setInterval(() => void this.fetches(), FETCH_ASK_EVERY_MS));
      this.timers.push(setInterval(() => void this.douyin(), DOUYIN_ASK_EVERY_MS));
    }, FIRST_ASK_DELAY_MS));
  }

  stop(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
  }

  private async x(): Promise<void> {
    const node = this.deps.node();
    if (node === null || this.xRunning) {
      return;
    }
    this.xRunning = true;
    try {
      const due = await node.api.xDue(node.credential);
      if (due.due) {
        await node.api.xReport(node.credential, await this.readX());
      }
    } catch (error) {
      this.deps.log(`X 时间线没读成：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.xRunning = false;
    }
  }

  private async readX(): Promise<XTimelineReport> {
    const window = hiddenWindow(this.deps);
    try {
      const page: XPage = {
        load: (url) => loadIn(window, url),
        run: (code) => window.webContents.executeJavaScriptInIsolatedWorld(X_WORLD, [{ code }]),
      };
      const read = await readXPlaces(page, { script: this.deps.pageScript('x-timeline'), sleep,
        log: (line) => this.deps.log(line) });
      return { requestId: `x-${randomUUID()}`, posts: read.posts.slice(0, X_POSTS_MAX), error: read.error };
    } finally {
      window.destroy();
    }
  }

  private async xhs(): Promise<void> {
    const node = this.deps.node();
    if (node === null || this.xhsRunning) {
      return;
    }
    this.xhsRunning = true;
    try {
      const due = await node.api.xhsDue(node.credential);
      if (due.due) {
        await node.api.xhsReport(node.credential, await this.readXhs());
      }
    } catch (error) {
      this.deps.log(`小红书没读成：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.xhsRunning = false;
    }
  }

  private async readXhs(): Promise<XhsReport> {
    const window = hiddenWindow(this.deps);
    try {
      const read = await readXhs({
        load: (url) => loadIn(window, url),
        run: (code) => window.webContents.executeJavaScript(code),
      }, { script: this.deps.pageScript('xhs'), sleep, log: (line) => this.deps.log(line) });
      return { requestId: `xhs-${randomUUID()}`, ...read };
    } finally {
      window.destroy();
    }
  }

  private async fetches(): Promise<void> {
    const node = this.deps.node();
    if (node === null || this.fetchRunning) {
      return;
    }
    this.fetchRunning = true;
    try {
      for (const job of await node.api.fetchJobs(node.credential)) {
        const result = await fetchForServer((url, init) => this.deps.session.fetch(url, init), job);
        await node.api.fetchReport(node.credential, { requestId: `ff-${randomUUID()}`, jobId: job.id, ...result });
      }
    } catch (error) {
      this.deps.log(`替服务器取网址没成：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.fetchRunning = false;
    }
  }

  private async douyin(): Promise<void> {
    const node = this.deps.node();
    if (node === null || this.douyinRunning) {
      return;
    }
    this.douyinRunning = true;
    try {
      const jobs = await node.api.douyinJobs(node.credential);
      if (jobs.length === 0) {
        return;
      }
      const { window, problem } = await hiddenPage(this.deps, 'https://www.douyin.com/');
      try {
        if (problem === null) {
          await window.webContents.executeJavaScript(this.deps.pageScript('douyin'));
        }
        for (const job of jobs) {
          for (const report of await this.douyinJob(window, job, problem)) {
            await node.api.douyinReport(node.credential, report);
          }
        }
      } finally {
        window.destroy();
      }
    } catch (error) {
      this.deps.log(`抖音没取成：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.douyinRunning = false;
    }
  }

  private async douyinJob(window: BrowserWindow, job: DouyinJob, problem: string | null): Promise<DouyinReport[]> {
    const base = (): { requestId: string; jobId: string } => ({ requestId: `dy-${randomUUID()}`, jobId: job.id });
    if (problem !== null) {
      return [{ ...base(), error: { code: 'load_failed', detail: problem.slice(0, 300) } }];
    }
    try {
      if (job.kind === 'list') {
        const list = await window.webContents.executeJavaScript(
          `window.__plasticineDouyin.list(${JSON.stringify(job.sinceIds)}, ${job.full === true})`) as
          Omit<NonNullable<DouyinReport['list']>, 'done'>;
        const reports: DouyinReport[] = [];
        for (let start = 0; start === 0 || start < list.works.length; start += DOUYIN_WORKS_PER_REPORT_MAX) {
          const works = list.works.slice(start, start + DOUYIN_WORKS_PER_REPORT_MAX);
          reports.push({ ...base(), list: { folders: start === 0 ? list.folders : [], works,
            done: start + DOUYIN_WORKS_PER_REPORT_MAX >= list.works.length } });
        }
        return reports;
      }
      const resolved = await window.webContents.executeJavaScript(
        `window.__plasticineDouyin.resolve(${JSON.stringify(job.workId)})`) as DouyinReport['resolved'];
      return [resolved === undefined ? { ...base(), error: { code: 'layout_changed' } } : { ...base(), resolved }];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (['signed_out', 'not_found', 'layout_changed'] as const).find((name) => message.includes(name));
      return [{ ...base(), error: { code: code ?? 'layout_changed', detail: message.slice(0, 300) } }];
    }
  }
}

export function readPageScript(directory: string, name: PageScript): string {
  return readFileSync(`${directory}/${name}.js`, 'utf8');
}
