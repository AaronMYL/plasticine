// 客户端自更新：从发布点（cyberhunter.top/download）的 desktop.json 查新版，下载、核对 SHA-256 和大小，下好了告诉他
// （设置 · 系统「客户端」那一行、系统通知），他点「重新打开」才换；换版本和坏版本退回由 update-scripts.ts 的脚本在
// 客户端退出后做。一步回退：Mac 换回「上一版」的 Contents，Windows 静默装回上一版的安装程序。每 6 小时自动查一次。
// 旧的 Swift Mac App 不读 desktop.json，不会被换成 Electron 版（第 18 条：他手动装一次）。

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { UpdateStatus } from '../../../agent/shared/api/desktop-bridge.ts';
import { DESKTOP_MANIFEST_FILE, parseDesktopManifest } from '../../../agent/shared/desktop-release.ts';
import type { ReleaseAsset } from '../../../agent/shared/release-manifest.ts';
import { HEALTH_WAIT_SECONDS, macSwapScript, windowsInstallScript } from './update-scripts.ts';

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_RELEASE_URL = 'https://cyberhunter.top/download';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/'
  + 'lsregister';

const StateSchema = Type.Object({
  skipped: Type.Array(Type.String()),
  previous: Type.Union([Type.String(), Type.Null()]),
  checkedAt: Type.Union([Type.String(), Type.Null()]),
  problem: Type.Union([Type.String(), Type.Null()]),
});
type State = Static<typeof StateSchema>;

export interface UpdateDeps {
  platform: 'darwin' | 'win32' | 'linux';
  version: string;
  packaged: boolean;
  releaseUrl: string;
  directory: string;
  /** Mac：正在用的 Plasticine.app；Windows：主程序 .exe。 */
  installed: string;
  pid: number;
  fetchBytes(url: string): Promise<Uint8Array>;
  /** Mac：用 ditto 解开 zip。 */
  extractZip(zip: string, into: string): Promise<void>;
  /** Mac：用本机证书重签并核对。 */
  resign(app: string): Promise<void>;
  launchDetached(file: string, args: readonly string[]): void;
  quit(): void;
  now(): Date;
  log(line: string): void;
}

/**
 * 版本的规范写法：逐段去掉前导零（2026.0108.093012 → 2026.108.93012）。发布版本号的月日、时分秒带前导零，semver 不收，
 * 安装包里的版本（app.getVersion）是去掉前导零的；比较、记号文件、跳过清单都用规范写法，两种写法认成同一版。
 */
export function canonicalVersion(version: string): string {
  return version.split('.').map((part) => String(Number.parseInt(part, 10))).join('.');
}

function newer(candidate: string, current: string): boolean {
  const left = candidate.split('.').map(Number);
  const right = current.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return false;
}

function findApp(directory: string): string | null {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      return join(directory, entry.name);
    }
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nested = findApp(join(directory, entry.name));
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
}

export class UpdateManager {
  private readonly deps: UpdateDeps;
  private stateValue: UpdateStatus['state'] = 'idle';
  private available: { version: string; file: string } | null = null;
  private readonly listeners = new Set<(status: UpdateStatus) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: UpdateDeps) {
    this.deps = { ...deps, version: canonicalVersion(deps.version) };
  }

  status(): UpdateStatus {
    const state = this.state();
    return { version: this.deps.version, state: this.stateValue, available: this.available?.version ?? null,
      previous: state.previous, checkedAt: state.checkedAt, problem: state.problem };
  }

  onChange(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 新版主窗口载入完调：写下「起来了」的记号；读上一次坏版本退回的记录。 */
  started(): void {
    mkdirSync(this.deps.directory, { recursive: true });
    writeFileSync(join(this.deps.directory, `started-${this.deps.version}`), this.deps.now().toISOString());
    const rolled = join(this.deps.directory, 'rolled-back.json');
    if (existsSync(rolled)) {
      const failed = canonicalVersion(String((JSON.parse(readFileSync(rolled, 'utf8')) as { failed?: unknown })
        .failed ?? '0'));
      renameSync(rolled, `${rolled}.${this.deps.now().getTime()}`);
      this.save((state) => ({ ...state, skipped: [...new Set([...state.skipped, failed])],
        problem: `${failed} 装上后没起来，已退回 ${this.deps.version}；等下一版。` }));
    }
  }

  /** 开始每 6 小时查一次（开发版和 Linux 不查）。 */
  schedule(): void {
    if (!this.supported()) {
      return;
    }
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async check(): Promise<UpdateStatus> {
    if (!this.supported()) {
      this.save((state) => ({ ...state, problem: '开发版不自更新。' }));
      return this.status();
    }
    if (this.stateValue === 'downloading' || this.stateValue === 'installing') {
      return this.status();
    }
    this.set('checking');
    try {
      const base = this.deps.releaseUrl.endsWith('/') ? this.deps.releaseUrl : `${this.deps.releaseUrl}/`;
      const location = new URL(DESKTOP_MANIFEST_FILE, base);
      const manifest = parseDesktopManifest(new TextDecoder().decode(await this.deps.fetchBytes(location.href)));
      const asset = this.deps.platform === 'darwin' ? manifest.assets.mac : manifest.assets.windows;
      this.save((state) => ({ ...state, checkedAt: this.deps.now().toISOString(), problem: null }));
      const version = canonicalVersion(manifest.version);
      if (asset === undefined || !newer(version, this.deps.version) || this.state().skipped.includes(version)) {
        this.set('up_to_date');
        return this.status();
      }
      this.set('downloading');
      const file = await this.download(asset, location, version);
      this.available = { version, file };
      this.set('ready');
    } catch (error) {
      this.fail(`查更新没成：${error instanceof Error ? error.message : String(error)}`);
    }
    return this.status();
  }

  /** 装上下好的新版并重新打开。 */
  install(): void {
    const ready = this.available;
    if (ready === null || this.stateValue !== 'ready') {
      return;
    }
    this.set('installing');
    void this.swapTo(ready.version, ready.file, false).catch((error: unknown) => {
      this.fail(`更新没装上：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  rollback(): void {
    const previous = this.state().previous;
    if (previous === null) {
      this.fail('没有可以退回的上一版。');
      return;
    }
    this.set('installing');
    const source = this.deps.platform === 'darwin' ? join(this.deps.directory, 'previous', 'Plasticine.app')
      : join(this.deps.directory, 'installers', `${previous}.exe`);
    void this.swapTo(previous, source, true).catch((error: unknown) => {
      this.fail(`没退回去：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private supported(): boolean {
    return this.deps.packaged && this.deps.platform !== 'linux';
  }

  private async download(asset: ReleaseAsset, manifest: URL, version: string): Promise<string> {
    const url = new URL(asset.url, manifest);
    if (url.protocol !== 'https:') {
      throw new Error('更新包的地址不是 https。');
    }
    const bytes = await this.deps.fetchBytes(url.href);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== asset.size || sha !== asset.sha256) {
      throw new Error(`${asset.name} 的大小或 SHA-256 和发布清单对不上，没有装。`);
    }
    const directory = join(this.deps.directory, 'downloads', version);
    mkdirSync(directory, { recursive: true });
    const file = join(directory, basename(asset.name));
    writeFileSync(file, bytes);
    return file;
  }

  private async swapTo(version: string, source: string, rollingBack: boolean): Promise<void> {
    const marker = join(this.deps.directory, `started-${version}`);
    const rolledBack = join(this.deps.directory, 'rolled-back.json');
    if (this.deps.platform === 'darwin') {
      const staging = join(this.deps.directory, 'staging', version);
      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true });
      let incoming: string;
      if (rollingBack) {
        incoming = join(staging, 'Plasticine.app');
        renameSync(source, incoming);
      } else {
        await this.deps.extractZip(source, staging);
        const found = findApp(staging);
        if (found === null) {
          throw new Error('更新包里没有 Plasticine.app。');
        }
        incoming = found;
        await this.deps.resign(incoming);
      }
      const script = join(this.deps.directory, 'swap.sh');
      writeFileSync(script, macSwapScript({ pid: this.deps.pid, app: this.deps.installed, incoming,
        previous: join(this.deps.directory, 'previous', 'Plasticine.app'), marker, rolledBack, version,
        open: '/usr/bin/open', lsregister: LSREGISTER, waitSeconds: HEALTH_WAIT_SECONDS }), { mode: 0o700 });
      this.save((state) => ({ ...state, previous: this.deps.version }));
      this.deps.launchDetached('/bin/sh', [script]);
    } else {
      const installers = join(this.deps.directory, 'installers');
      mkdirSync(installers, { recursive: true });
      const setup = join(installers, `${version}.exe`);
      if (!rollingBack) {
        cpSync(source, setup);
      }
      const previousSetup = join(installers, `${this.deps.version}.exe`);
      const script = join(this.deps.directory, 'install.ps1');
      writeFileSync(script, `﻿${windowsInstallScript({ pid: this.deps.pid, setup,
        previousSetup: existsSync(previousSetup) ? previousSetup : null, marker, rolledBack, version,
        exeName: basename(this.deps.installed), waitSeconds: HEALTH_WAIT_SECONDS })}`);
      this.save((state) => ({ ...state, previous: existsSync(previousSetup) ? this.deps.version : null }));
      this.deps.launchDetached('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle',
        'Hidden', '-File', script]);
    }
    this.deps.quit();
  }

  private state(): State {
    const file = join(this.deps.directory, 'state.json');
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (Value.Check(StateSchema, raw)) {
        return raw;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
    return { skipped: [], previous: null, checkedAt: null, problem: null };
  }

  private save(change: (state: State) => State): void {
    mkdirSync(this.deps.directory, { recursive: true });
    const file = join(this.deps.directory, 'state.json');
    writeFileSync(`${file}.partial`, JSON.stringify(change(this.state())));
    renameSync(`${file}.partial`, file);
    this.emit();
  }

  private fail(problem: string): void {
    this.deps.log(problem);
    this.stateValue = 'failed';
    this.save((state) => ({ ...state, problem }));
  }

  private set(state: UpdateStatus['state']): void {
    this.stateValue = state;
    this.emit();
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}
