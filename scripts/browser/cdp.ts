// Isolated local Chromium, controlled with CDP. Uses a fresh TEMP profile; never opens the user's browser profile.
// 2026-11-04 起验收一律「装成客户端」（他定）：浏览器按有鼠标启动，page() 默认把页面装成 Mac App
// （as-client.ts：客户端 User-Agent、1440×900、模拟的原生桥），'phone' 是 390×844 触屏的手机浏览器，
// 'web' 是普通浏览器（网页是正式端，没有门禁）。关浏览器时按共享协议核对每一页调过的桥（fake-native.ts）。
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { prepareClient } from './as-client.ts';
import type { ClientName, ClientProfile } from './client-profile.ts';
import { nativeCallProblem, nativeCalls, type NativeCall } from './fake-native.ts';

/**
 * 无头 Chromium 默认按没有鼠标处理（hover: none），电脑上的悬停（跟随浮框、行尾 ⋯、标签预览）都不出。
 * 按有鼠标、精确指针启动；手机页面再用触屏模拟切回 hover: none、pointer: coarse（as-client.ts）。
 */
export const MOUSE_FLAGS = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,'
  + 'primaryPointerType=4,availablePointerTypes=4';
/** 打开一页最多等这么久（创建、导航到本地页面并开始解析）。 */
const PAGE_READY_MS = 15_000;

export class Cdp {
  private readonly socket: WebSocket;
  private next = 0;
  private readonly pending = new Map<number, {
    method: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void;
  }>();
  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number; result?: Record<string, unknown>; error?: { message: string };
      };
      if (message.id === undefined) {
        return;
      }
      const wait = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        wait?.reject(new Error(message.error.message));
      }
      else {
        wait?.resolve(message.result ?? {});
      }
    });
    socket.addEventListener('close', () => {
      for (const wait of this.pending.values()) {
        // Chromium 可能先关闭调试连接，再发送 Browser.close / Page.close 的响应；进程退出由 LocalBrowser.close 核实。
        if (wait.method === 'Browser.close' || wait.method === 'Page.close') wait.resolve({});
        else wait.reject(new Error('浏览器连接已关闭'));
      }
      this.pending.clear();
    });
  }
  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('连不上本地浏览器')), { once: true });
    });
    return new Cdp(socket);
  }
  async send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result['exceptionDetails'] !== undefined) {
      throw new Error(`浏览器脚本失败：${JSON.stringify(result['exceptionDetails'])}`);
    }
    return (result['result'] as { value: T }).value;
  }
  get open(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }
  close(): void {
    this.socket.close();
  }
}

/** 关浏览器前核对这一页调过的桥；页面已经读不了（崩了、正在关）就说一声跳过，不当成协议问题。 */
async function nativeProblems(page: Cdp): Promise<string[]> {
  let calls: NativeCall[];
  try {
    calls = await nativeCalls(page);
  } catch (error) {
    console.warn('关浏览器前没能读到这一页的原生桥调用记录，跳过协议核对', error);
    return [];
  }
  return calls.flatMap((call) => {
    const problem = nativeCallProblem(call);
    return problem === null ? [] : [`网页调原生桥不合协议：${call.channel}.${call.method}：${problem}`];
  });
}

export interface PageOptions {
  /** 放进一个新的浏览器上下文：不和别的页面共用 Cookie、localStorage、IndexedDB（截图每张一份干净状态）。 */
  isolated?: boolean;
}

export interface LocalBrowser {
  readonly endpoint: string;
  /** 打开一页，默认装成 Mac App；client 见 client-profile.ts。 */
  page(url: string, client?: ClientName | ClientProfile, options?: PageOptions): Promise<Cdp>;
  close(): Promise<void>;
}

export async function launchBrowser(): Promise<LocalBrowser> {
  const configured = process.env['PLASTICINE_TEST_BROWSER'];
  const binary = configured ?? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome',
  ].find(existsSync);
  if (binary === undefined) {
    throw new Error('没有本地 Chromium；设置 PLASTICINE_TEST_BROWSER 后再运行浏览器回归');
  }
  const profile = await mkdtemp(join(tmpdir(), 'plasticine-browser-'));
  const child: ChildProcess = spawn(binary, [
    '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    MOUSE_FLAGS, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let launchError: Error | undefined;
  child.on('error', (error) => {
    launchError = error;
  });
  let port: string | undefined;
  const deadline = Date.now() + 15_000;
  while (port === undefined && Date.now() < deadline && child.exitCode === null && launchError === undefined) {
    const active = join(profile, 'DevToolsActivePort');
    if (existsSync(active)) {
      try {
        const value = (await readFile(active, 'utf8')).split('\n')[0]?.trim();
        if (value !== undefined && /^\d+$/.test(value)) {
          port = value;
        } else {
          await pause(100);
        }
      } catch (error) {
        // Windows 上文件刚创建时 Chromium 可能尚未释放写入锁；只重试短暂占用或创建时序。
        if (error instanceof Error && 'code' in error && ['EBUSY', 'ENOENT'].includes(String(error.code))) {
          await pause(100);
        } else {
          child.kill();
          throw error;
        }
      }
    }
    else {
      await pause(100);
    }
  }
  if (port === undefined) {
    child.kill();
    throw launchError ?? new Error('浏览器未启动或启动被策略拦截');
  }
  const base = `http://127.0.0.1:${port}`;
  const version = await fetch(`${base}/json/version`).then((res) => res.json()) as { webSocketDebuggerUrl: string };
  const browser = await Cdp.connect(version.webSocketDebuggerUrl);
  const pages: Cdp[] = [];
  return {
    endpoint: base,
    async page(url, client = 'mac', options = {}) {
      if (!url.startsWith('http://127.0.0.1:')) {
        throw new Error('浏览器回归只访问本地 HTTP 页面');
      }
      const context = options.isolated === true
        ? { browserContextId: (await browser.send('Target.createBrowserContext'))['browserContextId'] }
        : {};
      const created = await browser.send('Target.createTarget', { url: 'about:blank', ...context });
      const targetId = created['targetId'];
      if (typeof targetId !== 'string') {
        throw new Error('浏览器没有开出新页面');
      }
      const page = await Cdp.connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
      pages.push(page);
      // 先装成客户端再导航：网页第一行脚本跑的时候 User-Agent 和桥都已经在了。
      await prepareClient(page, client);
      await page.send('Page.navigate', { url });
      // 不比对完整地址：网页会自己改地址栏（hash 路由补上默认页）。
      const deadline = Date.now() + PAGE_READY_MS;
      while (!await page.evaluate<boolean>(
        `location.href !== 'about:blank' && document.readyState !== 'loading'`,
      )) {
        if (Date.now() >= deadline) throw new Error(`本地测试页面未完成导航：${url}`);
        await pause(50);
      }
      return page;
    },
    async close() {
      const problems: string[] = [];
      for (const page of pages) {
        if (page.open) {
          problems.push(...await nativeProblems(page));
        }
        page.close();
      }
      await browser.send('Browser.close');
      browser.close();
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      }
      const absolute = resolve(profile);
      if (!absolute.startsWith(`${resolve(tmpdir())}\\plasticine-browser-`)
        && !absolute.startsWith(`${resolve(tmpdir())}/plasticine-browser-`)) {
          throw new Error('临时浏览器目录越界');
        }
      await rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      if (problems.length > 0) {
        throw new Error(problems.join('\n'));
      }
    },
  };
}
