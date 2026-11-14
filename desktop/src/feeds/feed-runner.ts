// 信息流要这台电脑做的几样（用他在 Plasticine 浏览器里的登录；登录只在这台电脑上，不进本体）：
// - X 时间线（agent/shared/api/feed-x.ts）：每 10 分钟问本体到没到，到了在一个看不见的窗口里读「正在关注」「为你推荐」
//   「书签」三处（第13批，x-places.ts），只露一段的长帖再载入帖子页补全文，合起来交回。Mac App 的 x-timeline-reader.swift
//   还只读「关注」。
// - 小红书（第13批，agent/shared/api/feed-xhs.ts）：和 X 一样每 10 分钟问到没到，到了读首页「推荐」和自己的收藏
//   （xhs-read.ts），在网页自己的脚本世界里读（要读页面自带的初始数据）。
// - 替服务器取网址（第13批，fetch-for-server.ts）：服务器连不上、被限流的博客和 Reddit，每半分钟领一次活，用这台电脑
//   的网络取回正文交回（不带登录信息），解析、入库在本体。
// - 抖音收藏和下载地址（docs/specs/video-parse.md）：每分钟领活，在看不见的窗口里载入 douyin.com，在网页自己的脚本世界
//   （签名要页面自己的脚本加）里装上 douyin-page 的读取器，翻收藏 / 取地址，交回。
// 没配对、设备服务暂停时不读；读完就把窗口拆掉。注入的脚本是 client/src/mac/x-timeline-page.ts、douyin-page.ts、
// xhs-page.ts，构建时打成 dist/pages/*.js。

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
/** 替服务器取网址：领活的间隔（本体也靠它知道电脑在线）。 */
const FETCH_ASK_EVERY_MS = 30_000;
/** 启动后先等一会儿再问，别和启动时的同步、自更新挤在一起。 */
const FIRST_ASK_DELAY_MS = 90_000;
const LOAD_TIMEOUT_MS = 30_000;
/** X 的 isolated world 编号（和界面、标签的 preload 世界错开）。 */
const X_WORLD = 1_017;

export type PageScript = 'x-timeline' | 'douyin' | 'xhs';

export interface FeedDeps {
  session: Session;
  userAgent: string;
  /** 现在配对着的本体和凭证；没配对、暂停时是 null。 */
  node(): { api: NodeApi; credential: string } | null;
  pageScript(name: PageScript): string;
  log(line: string): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 一个看不见的窗口：和网页标签同一份登录，静音，不因为看不见就放慢。 */
function hiddenWindow(deps: FeedDeps): BrowserWindow {
  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
    session: deps.session, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  window.webContents.setUserAgent(deps.userAgent);
  window.webContents.setAudioMuted(true);
  return window;
}

/** 在这个窗口里载入一页；载入失败回原因。 */
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

/** 在一个看不见的窗口里载入一页；载入失败回原因。 */
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

  /** 领服务器取不到的网址，用这台电脑的网络取回交回。 */
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

  /** 一件活的回执；翻收藏一次最多交 200 条，多的分几次交（done 只在最后一次为真）。 */
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

/** 构建好的注入脚本（dist/pages/<名字>.js）。 */
export function readPageScript(directory: string, name: PageScript): string {
  return readFileSync(`${directory}/${name}.js`, 'utf8');
}
