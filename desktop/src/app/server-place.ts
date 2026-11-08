// 本体跑在哪落到窗口上（11-08 首次使用流程）：第一次打开先在开始页二选一（pages/start.html，不替他选）；这台电脑就
// 拉起并守着自带的本体、等它答上，按账号状态进建账号页或替界面登录后进首页；远程就先探地址、停掉本机本体、载入远程
// 的登录页。远程没地址、本机没带本体都回开始页。还没起来、没起来时窗口也显示开始页。切换不搬数据（他 11-06 定）。
// 界面视图只留在本站：别的网址开成网页标签。

import { pathToFileURL } from 'node:url';
import type { WebContents } from 'electron';
import type { ServerChoice, ServerStatus } from '../../../agent/shared/api/desktop-bridge.ts';
import type { LocalServer } from './local-server.ts';
import { parsePlaceAddress } from './place-address.ts';
import { LOCAL_SERVER_URL, sameOrigin, targetUrl } from './server-target.ts';
import { serverChosen, type SettingsStore } from './settings-store.ts';

export interface ServerPlaceDeps {
  ui: WebContents;
  settings: SettingsStore;
  local: LocalServer;
  /** pages/start.html 的路径。 */
  startPage: string;
  /** 开发、冒烟测试：直接载入这个地址（不起本机本体）。 */
  override: string | null;
  /** 本机本体答上以后进哪一页（拼在本机地址后面，account-client.ts 的 enterLocal）。 */
  enterLocal(): Promise<string>;
  /** 连远程之前探地址；到不了抛错，消息是给他看的一句话。 */
  probe(origin: string): Promise<void>;
  openExternal(url: string): void;
  log(line: string): void;
}

type StartState = 'welcome' | 'starting' | 'failed';

export class ServerPlace {
  private readonly deps: ServerPlaceDeps;
  private readonly listeners = new Set<(status: ServerStatus) => void>();
  private loaded = '';
  /** 开始页现在显示的是哪一态；不在开始页是 null。 */
  private showing: StartState | null = null;
  /** 每次载入加一：晚到的本机本体结果发现他已经换了地方，就不再跳。 */
  private generation = 0;
  private waitingLocal = false;

  constructor(deps: ServerPlaceDeps) {
    this.deps = deps;
    deps.local.onChange(() => {
      this.emit();
      void this.followLocal();
    });
  }

  /** 界面该在的本站源地址；还没选、远程没地址时是 null。 */
  target(): string | null {
    if (this.deps.override !== null) {
      return this.deps.override;
    }
    const settings = this.deps.settings.get();
    return serverChosen(settings) ? targetUrl(settings.server, this.bundled()) : null;
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

  /** 选的是这台电脑（菜单里「重设密码…」只在这时有）。 */
  thisComputer(): boolean {
    return this.deps.override === null && this.target() === LOCAL_SERVER_URL;
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
    // 设置 · 系统里填的也一样认 @账号（开始页传来的已经是规整好的地址）。
    const remoteUrl = choice.remoteUrl === null ? null : parsePlaceAddress(choice.remoteUrl).url;
    if (choice.mode === 'remote') {
      if (remoteUrl === null) {
        throw new Error('选远程要先填 @账号或地址。');
      }
      await this.deps.probe(remoteUrl);
    } else if (!this.bundled()) {
      throw new Error('这个安装包没有带本体，只能连到你的 Plasticine。');
    }
    this.deps.settings.update((settings) => ({ ...settings, server: { mode: choice.mode, remoteUrl },
      serverChosen: true }));
    this.emit();
    await this.load(choice.mode === 'remote' ? '#/login' : '');
    return this.status();
  }

  /** 回开始页二选一（菜单「连接到…」、界面登录页的「换一个地方」）。本机本体照跑，等他选了别的才停。 */
  async welcome(): Promise<void> {
    this.generation += 1;
    await this.page('welcome', '');
  }

  /** 按现在的选择载入窗口。remoteEntry：连远程时拼在地址后面（从开始页选过来的进登录页）。 */
  async load(remoteEntry = ''): Promise<void> {
    this.generation += 1;
    if (this.deps.override !== null) {
      await this.show(this.deps.override);
      return;
    }
    const target = this.target();
    if (target === null) {
      await this.page('welcome', '');
      return;
    }
    if (target === LOCAL_SERVER_URL) {
      await this.openLocal(this.generation);
      return;
    }
    await this.deps.local.stop();
    await this.show(`${target}${remoteEntry}`);
  }

  /** 界面是不是登录着（不在本站、或本站问 /v2/session 没答 200 都算没有）。 */
  async signedIn(): Promise<boolean> {
    if (!this.onSite()) {
      return false;
    }
    const answer: unknown = await this.deps.ui.executeJavaScript(
      "fetch('/v2/session', { credentials: 'same-origin' }).then((r) => r.ok, () => false)");
    return answer === true;
  }

  /** 界面视图只留在本站和开始页；别的网址开成网页标签，http(s) 以外的交给系统。 */
  guardNavigation(openTab: (url: string) => void): void {
    const allowed = (url: string): boolean => url.startsWith(this.startPageUrl())
      || (this.target() !== null && sameOrigin(url, this.target() ?? ''));
    const elsewhere = (url: string): void => {
      if (/^https?:\/\//i.test(url)) {
        openTab(url);
      } else if (/^(mailto|tel):/i.test(url)) {
        this.deps.openExternal(url);
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

  private async openLocal(generation: number): Promise<void> {
    if (this.deps.local.state !== 'running') {
      await this.page('starting', '');
    }
    this.waitingLocal = true;
    let running: boolean;
    try {
      running = await this.deps.local.start();
    } finally {
      this.waitingLocal = false;
    }
    if (generation !== this.generation) {
      return;
    }
    if (!running) {
      await this.page('failed', this.deps.local.problem ?? '');
      return;
    }
    const entry = await this.deps.enterLocal();
    if (generation === this.generation) {
      await this.show(`${LOCAL_SERVER_URL}${entry}`);
    }
  }

  /** 本机本体后来答上了（重启成功）而窗口还停在「正在打开」「没起来」：跟上。开始页的二选一不动。 */
  private async followLocal(): Promise<void> {
    if (this.waitingLocal || (this.showing !== 'starting' && this.showing !== 'failed')) {
      return;
    }
    if (this.deps.local.state === 'running' && this.target() === LOCAL_SERVER_URL) {
      this.generation += 1;
      await this.openLocal(this.generation);
    }
  }

  private async page(state: StartState, problem: string): Promise<void> {
    const settings = this.deps.settings.get();
    const url = new URL(this.startPageUrl());
    url.searchParams.set('state', state);
    url.searchParams.set('problem', problem);
    url.searchParams.set('bundled', this.bundled() ? '1' : '0');
    if (serverChosen(settings)) {
      url.searchParams.set('current', settings.server.mode);
    }
    if (settings.server.remoteUrl !== null) {
      url.searchParams.set('remote', settings.server.remoteUrl);
    }
    await this.show(url.href, state);
  }

  private async show(url: string, state: StartState | null = null): Promise<void> {
    this.showing = state;
    this.loaded = url.startsWith('file:') ? '' : new URL('/', url).href;
    try {
      await this.deps.ui.loadURL(url);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.deps.log(`窗口没载入 ${new URL(url).origin}：${detail}`);
      if (!url.startsWith('file:')) {
        await this.page('failed', `连不上 ${new URL(url).host}。网络好了以后重新打开 Plasticine，或换一个地方。`);
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
