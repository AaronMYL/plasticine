// Linux 安装包的自更新（docs/install-packages.md）：开机后和每天由 plasticine-update.timer 跑一次。
// 读发布清单 → 有更新的版本就下载服务包 → 核对 SHA-256 和大小 → 解到 versions/<版本> → current 换过去、
// 旧的记成 previous → 重启服务 → 健康检查；不健康就换回 previous、重启，并记下这一版不再自动装。
// 所有外部动作（网络、解包、重启、健康检查）都从 deps 进来，测试注入假的。

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acquireLock, expirePrevious, layoutOf, pointedVersion, pointTo, prune, readServerManifest, readState,
  writeState, type Layout } from './install-layout.ts';
import { assetUrl, isNewerVersion, manifestUrl, parseReleaseManifest, sameNodeMajor, sha256Hex,
  type ReleaseManifest } from './release-manifest.ts';

export interface UpdaterDeps {
  fetchBytes(url: URL): Promise<Uint8Array>;
  /** 解开服务包（去掉顶层目录）到 `into`。 */
  extract(archive: string, into: string): Promise<void>;
  /** 跑重启命令，返回退出码。 */
  restart(command: readonly string[]): Promise<number>;
  /** 服务在 `timeoutMs` 内答上 /v2/health 就是 true。 */
  healthy(port: number, timeoutMs: number): Promise<boolean>;
  now(): Date;
  log(line: string): void;
  nodeVersion: string;
}

export interface UpdateOptions {
  root: string;
  /** 不给就用当前版本 manifest.json 里的 releaseUrl。 */
  releaseUrl?: string;
  /** 换好之后怎么重启服务；不给就只换指针，由调用方重启。 */
  restartCommand?: readonly string[];
  port: number;
  healthTimeoutMs: number;
}

export type UpdateOutcome =
  | { kind: 'up_to_date'; version: string }
  | { kind: 'skipped'; version: string; reason: string }
  | { kind: 'updated'; from: string; to: string; restarted: boolean }
  | { kind: 'rolled_back'; to: string; failed: string };

async function download(release: ReleaseManifest, manifestLocation: URL, layout: Layout,
  deps: UpdaterDeps): Promise<string> {
  const asset = release.assets.server;
  const url = assetUrl(asset, manifestLocation.href);
  deps.log(`下载 ${asset.name}`);
  const bytes = await deps.fetchBytes(url);
  if (bytes.length !== asset.size || sha256Hex(bytes) !== asset.sha256) {
    throw new Error(`${asset.name} 的大小或 SHA-256 和发布清单对不上，没有安装。`);
  }
  mkdirSync(layout.downloads, { recursive: true });
  const file = join(layout.downloads, asset.name);
  writeFileSync(file, bytes);
  return file;
}

async function unpack(file: string, version: string, layout: Layout, deps: UpdaterDeps): Promise<void> {
  const target = join(layout.versions, version);
  const partial = `${target}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  await deps.extract(file, partial);
  const unpacked = readServerManifest(partial);
  if (unpacked.version !== version) {
    rmSync(partial, { recursive: true, force: true });
    throw new Error(`包里的版本是 ${unpacked.version}，发布清单说是 ${version}，没有安装。`);
  }
  rmSync(target, { recursive: true, force: true });
  renameSync(partial, target);
}

/** 重启并等健康；没有重启命令时不重启，算成功（调用方自己重启）。 */
async function restartAndCheck(options: UpdateOptions, deps: UpdaterDeps): Promise<boolean> {
  if (options.restartCommand === undefined) {
    return true;
  }
  const code = await deps.restart(options.restartCommand);
  if (code !== 0) {
    deps.log(`重启命令退出码 ${code}`);
    return false;
  }
  return deps.healthy(options.port, options.healthTimeoutMs);
}

function record(layout: Layout, deps: UpdaterDeps, result: string, skip?: string): void {
  const state = readState(layout);
  const skipped = skip === undefined || state.skipped.includes(skip) ? state.skipped : [...state.skipped, skip];
  writeState(layout, { ...state, lastCheckAt: deps.now().toISOString(), lastResult: result, skipped });
}

async function checkAndInstall(options: UpdateOptions, layout: Layout, deps: UpdaterDeps): Promise<UpdateOutcome> {
  const current = pointedVersion(layout.current);
  if (current === null) {
    throw new Error(`${layout.current} 不存在：还没装过，先运行 install.sh。`);
  }
  // 每次检查（定时器每天一次）都先看上一版到没到期，所以没有新版本也会清。
  const expired = expirePrevious(layout, deps.now());
  if (expired !== null) {
    deps.log(`上一版 ${expired} 留满 7 天，已删`);
  }
  const installed = readServerManifest(layout.current);
  const location = manifestUrl(options.releaseUrl ?? installed.releaseUrl);
  const release = parseReleaseManifest(new TextDecoder().decode(await deps.fetchBytes(location)));
  if (!isNewerVersion(release.version, installed.version)) {
    record(layout, deps, `已是最新（${installed.version}）`);
    return { kind: 'up_to_date', version: installed.version };
  }
  if (readState(layout).skipped.includes(release.version)) {
    const reason = '这一版上次装上后健康检查没过，已退回；等下一版。';
    record(layout, deps, `跳过 ${release.version}：${reason}`);
    return { kind: 'skipped', version: release.version, reason };
  }
  if (!sameNodeMajor(deps.nodeVersion, release.nodeVersion)) {
    const reason = `这一版要 Node ${release.nodeVersion}，本机是 ${deps.nodeVersion}；重跑一次安装命令升级 Node。`;
    record(layout, deps, `跳过 ${release.version}：${reason}`);
    return { kind: 'skipped', version: release.version, reason };
  }
  const file = await download(release, location, layout, deps);
  await unpack(file, release.version, layout, deps);
  const earlier = pointedVersion(layout.previous);
  const earlierSince = readState(layout).previousSince ?? null;
  pointTo(layout, layout.previous, current);
  pointTo(layout, layout.current, release.version);
  writeState(layout, { ...readState(layout), previousSince: deps.now().toISOString() });
  deps.log(`已换到 ${release.version}，上一版 ${installed.version} 留作回退`);
  if (await restartAndCheck(options, deps)) {
    prune(layout);
    record(layout, deps, `已更新到 ${release.version}`);
    return { kind: 'updated', from: installed.version, to: release.version,
      restarted: options.restartCommand !== undefined };
  }
  deps.log(`${release.version} 启动后健康检查没过，退回 ${installed.version}`);
  pointTo(layout, layout.current, current);
  pointTo(layout, layout.previous, earlier);
  writeState(layout, { ...readState(layout), previousSince: earlierSince });
  await restartAndCheck(options, deps);
  prune(layout);
  record(layout, deps, `${release.version} 不健康，已退回 ${installed.version}`, release.version);
  return { kind: 'rolled_back', to: installed.version, failed: release.version };
}

export async function update(options: UpdateOptions, deps: UpdaterDeps): Promise<UpdateOutcome> {
  const layout = layoutOf(options.root);
  const release = acquireLock(layout, deps.now());
  try {
    return await checkAndInstall(options, layout, deps);
  } finally {
    release();
  }
}

export type RollbackOutcome = { kind: 'rolled_back'; from: string; to: string; healthy: boolean };

/** 一步回退：current 和 previous 对调、重启。再跑一次就又回到原来那版。 */
export async function rollback(options: UpdateOptions, deps: UpdaterDeps): Promise<RollbackOutcome> {
  const layout = layoutOf(options.root);
  const release = acquireLock(layout, deps.now());
  try {
    const current = pointedVersion(layout.current);
    const previous = pointedVersion(layout.previous);
    if (current === null || previous === null || !existsSync(join(layout.versions, previous))) {
      throw new Error('没有可以回退的上一版。');
    }
    pointTo(layout, layout.current, previous);
    pointTo(layout, layout.previous, current);
    writeState(layout, { ...readState(layout), previousSince: deps.now().toISOString() });
    const healthy = await restartAndCheck(options, deps);
    record(layout, deps, `手动回退到 ${previous}${healthy ? '' : '（健康检查没过）'}`);
    return { kind: 'rolled_back', from: current, to: previous, healthy };
  } finally {
    release();
  }
}

export function status(root: string): { current: string | null; previous: string | null; lastResult: string | null;
  lastCheckAt: string | null; skipped: string[] } {
  const layout = layoutOf(root);
  const state = readState(layout);
  return { current: pointedVersion(layout.current), previous: pointedVersion(layout.previous),
    lastResult: state.lastResult, lastCheckAt: state.lastCheckAt, skipped: state.skipped };
}
