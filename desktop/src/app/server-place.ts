// 本体跑在哪（设置 · 系统「Plasticine 跑在哪」）落到窗口上：这台电脑就拉起并守着自带的本体、等它答上再载入
// http://127.0.0.1:8790/；远程就停掉本机本体、载入远程地址。还没起来、没起来、没填过远程地址时窗口显示开始页
// （pages/start.html）。切换不搬数据：两边的数据各是各的（他 11-06 定）。界面视图只留在本站：别的网址开成网页标签。

import { pathToFileURL } from 'node:url';
import { shell, type WebContents } from 'electron';
import type { ServerChoice, ServerStatus } from '../../../agent/shared/api/desktop-bridge.ts';
import type { LocalServer } from './local-server.ts';
import { LOCAL_SERVER_URL, normalizeRemoteUrl, sameOrigin, targetUrl } from './server-target.ts';
import type { SettingsStore } from './settings-store.ts';

export interface ServerPlaceDeps {
  ui: WebContents;
  settings: SettingsStore;
  local: LocalServer;
  /** pages/start.html 的路径。 */
  startPage: string;
  /** 开发、冒烟测试：直接载入这个地址（不起本机本体）。 */
  override: string | null;
  log(line: string): void;
}

export class ServerPlace {
  private readonly deps: ServerPlaceDeps;
  private readonly listeners = new Set<(status: ServerStatus) => void>();
  private loaded = '';

  constructor(deps: ServerPlaceDeps) {
    this.deps = deps;
    deps.local.onChange(() => {
      this.emit();
      void this.followLocal();
    });
  }

  /** 界面该在的本站源地址；没有（等着填远程地址）是 null。 */
  target(): string | null {
    return this.deps.override ?? targetUrl(this.deps.settings.get().server, this.bundled());
  }

  /** 设备服务该连的本体：界面在本站时就是它。 */
  server(): string | null {
    const target = this.target();
    return target !== null && this.onSite() ? new URL('/', target).href : null;
  }

  onSite(): boolean {
    const target = this.target();
    return target !== null && sameOrigin(this.deps.ui.getURL(), target);
  }

  startPageUrl(): string {
    return pathToFileURL(this.deps.startPage).href;
  }

  onChange(listener: (status: ServerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): ServerStatus {
    return { choice: this.deps.settings.get().server, bundled: this.bundled(), local: this.deps.local.state,
      problem: this.deps.local.problem, loaded: this.loaded };
  }

  async choose(choice: ServerChoice): Promise<ServerStatus> {
    const remoteUrl = choice.remoteUrl === null ? null : normalizeRemoteUrl(choice.remoteUrl);
    if (choice.mode === 'remote' && remoteUrl === null) {
      throw new Error('选远程要先填远程地址。');
    }
    this.deps.settings.update((settings) => ({ ...settings, server: { mode: choice.mode, remoteUrl } }));
    await this.load();
    return this.status();
  }

  /** 按现在的选择载入窗口（这台电脑：先等本机本体答上）。 */
  async load(): Promise<void> {
    if (this.deps.override !== null) {
      await this.show(this.deps.override);
      return;
    }
    const choice = this.deps.settings.get().server;
    const target = this.target();
    if (target === null) {
      await this.deps.local.stop();
      await this.page('setup', '');
      return;
    }
    if (target === LOCAL_SERVER_URL && (choice.mode === 'this_computer' || choice.remoteUrl === null)) {
      if (this.deps.local.state !== 'running') {
        await this.page('starting', '');
      }
      const running = await this.deps.local.start();
      if (running) {
        await this.show(target);
      } else {
        await this.page('failed', this.deps.local.problem ?? '');
      }
      return;
    }
    await this.deps.local.stop();
    await this.show(target);
  }

  /** 界面视图只留在本站和开始页；别的网址开成网页标签，http(s) 以外的交给系统。 */
  guardNavigation(openTab: (url: string) => void): void {
    const allowed = (url: string): boolean => url.startsWith(this.startPageUrl())
      || (this.target() !== null && sameOrigin(url, this.target() ?? ''));
    const elsewhere = (url: string): void => {
      if (/^https?:\/\//i.test(url)) {
        openTab(url);
      } else if (/^(mailto|tel):/i.test(url)) {
        void shell.openExternal(url);
      }
    };
    this.deps.ui.on('will-navigate', (event, url) => {
      if (!allowed(url)) {
        event.preventDefault();
        elsewhere(url);
      }
    });
    this.deps.ui.setWindowOpenHandler(({ url }) => {
      elsewhere(url);
      return { action: 'deny' };
    });
  }

  private bundled(): boolean {
    return this.deps.local.state !== 'absent';
  }

  /** 本机本体后来答上了（或倒下了）而窗口还在开始页：跟上。 */
  private async followLocal(): Promise<void> {
    if (!this.deps.ui.getURL().startsWith(this.startPageUrl()) || this.deps.override !== null) {
      return;
    }
    if (this.deps.local.state === 'running' && this.target() === LOCAL_SERVER_URL) {
      await this.show(LOCAL_SERVER_URL);
    }
  }

  private async page(state: 'starting' | 'failed' | 'setup', problem: string): Promise<void> {
    const url = new URL(this.startPageUrl());
    url.searchParams.set('state', state);
    url.searchParams.set('problem', problem);
    await this.show(url.href);
  }

  private async show(url: string): Promise<void> {
    this.loaded = url.startsWith('file:') ? '' : new URL('/', url).href;
    try {
      await this.deps.ui.loadURL(url);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.deps.log(`窗口没载入 ${new URL(url).origin}：${detail}`);
      if (!url.startsWith('file:')) {
        await this.page('failed', `连不上 ${new URL(url).host}。网络好了以后重新打开 Plasticine，或改填远程地址。`);
        return;
      }
    }
    this.emit();
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}
