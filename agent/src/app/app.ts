// Puts the HTTP service together from its parts and runs its life: listen on the loopback address; before that, the
// start-up recovery (uploads cut off, device actions, backups, payment reads, memory curation, the network, the
// lines); on stop, take no new connections, end the event streams, stop the lines and the background work, then
// close the connections. Closing the library is the caller's last step.

import { createServer, type Server } from 'node:http';
import { adoptMateSouls, BookInsightService, ensureDefaultProjects, ensureMemoryDocs, NoteAssistant, PageTranslator,
  type GlossaryTerm, type MemoryCurator, type PaymentReader } from '../brain/index.ts';
import type { AskDesk, Presenter, PushService, ScanScheduler } from '../attention/index.ts';
import type { Daily } from '../daily/index.ts';
import type { DeviceService } from '../devices/index.ts';
import type { IntakeDesk } from '../intake/index.ts';
import type { Video } from '../video/index.ts';
import type { TextModels } from '../kernel/index.ts';
import type { MoneyDraftDesk } from '../life/index.ts';
import type { LineKernel } from '../lines/index.ts';
import type { Tasks } from '../tasks/index.ts';
import type { CalendarSync } from '../calendar/index.ts';
import type { Heartbeat } from '../heartbeat/index.ts';
import type { NetworkService, TunnelService } from '../network/index.ts';
import type { SkillStore } from '../skills/index.ts';
import { allPages, type StateService } from '../state/index.ts';
import type { BackupService, ClientReleases } from '../system/index.ts';
import { AttemptLimiter } from './attempt-limiter.ts';
import {
  HOST,
  PAIRING_FAILURE_LIMIT,
  PAIRING_FAILURE_WINDOW_MS,
  PASSWORD_FAILURE_LIMIT,
  PASSWORD_FAILURE_WINDOW_MS,
  PASSWORD_GLOBAL_FAILURE_LIMIT,
  SHUTDOWN_GRACE_MS,
  SSE_HEARTBEAT_MS,
} from './config.ts';
import type { AppDeps } from './context.ts';
import { attachDeviceStreams } from './device-streams.ts';
import { EventHub } from './event-hub.ts';
import { attachFeedStreams } from './feed.ts';
import type { M5bServices } from './m5b-services.ts';
import { attachM5bStreams } from './m5b-streams.ts';
import { withClientFiles } from './static-client.ts';
import type { MacDownloads } from './mac-updates.ts';
import type { KernelModelParts } from './model-providers.ts';
import { createRequestHandler } from './server.ts';
import { SourceLimiter } from './source-limiter.ts';
import { askView } from './asks.ts';
import { BrowserSessions } from './browser-sessions.ts';
import { DevicePaths } from './device-paths.ts';
import { DirectHub } from '../direct/hub.ts';

export interface AppOptions {
  state: StateService;
  text: TextModels;
  publicUrl?: () => string;
  desk: AskDesk;
  presenter: Presenter;
  push: PushService;
  now?: () => Date;
  hub?: EventHub;
  sseHeartbeatMs?: number;
  daily: Daily;
  scans: ScanScheduler;
  devices: DeviceService;
  /** Development dry run of external effects (decisions 8 and 68). */
  dryRun: boolean;
  m5b: M5bServices;
  moneyDrafts: MoneyDraftDesk;
  paymentReader: PaymentReader;
  clientUpdates: ClientReleases;
  backups: BackupService;
  skills: SkillStore;
  /** 记忆的后台整理（用户 2026-11-02 定）：主线每一轮结束后入队一次。 */
  memoryCurator: MemoryCurator;
  intake: IntakeDesk;
  /** Mac 自更新的包（app/mac-updates.ts）。 */
  macDownloads?: MacDownloads;
  /** 第 113 条：这台实例在网络上的那一头（network/）。 */
  network: NetworkService;
  /** 2026-11-05：<handle>.cyberhunter.top 的隧道（network/tunnel.ts）；和中继同机的实例不装。 */
  tunnel?: TunnelService;
  /** 新内核（2026-11-05 Harness 重做）：线（lines/）。 */
  lines: LineKernel;
  /** 新内核的模型连接（kernel/）。 */
  kernelModels?: KernelModelParts;
  /** 任务栏目：定时线、照卡发送、建议。 */
  tasks: Tasks;
  /** 心跳（《优化清单》第 11 条）：「定时」里点开心跳那一行的弹层。 */
  heartbeat: Heartbeat;
  /** 第 15 条：Apple 日历和提醒事项的缓存同步。 */
  calendar: CalendarSync;
  /** 测试可替换翻译通道；正式执行由 text 按 translation 用途解析。 */
  translateText?: TextModels;
  /** 安装包里的实例没有 Caddy，由服务自己发客户端构建（static-client.ts）。 */
  clientDirectory?: string;
  browserSessions?: BrowserSessions;
  /** 第 6 批第 9 条：视频解析与抖音收藏（video/）。 */
  video: Video;
  /** 桌面客户端给本体的本机令牌（PLASTICINE_LOCAL_TOKEN）；没设是 null，本机令牌一律不认。 */
  localToken?: string | null;
}

export interface App {
  deps: AppDeps;
  server: Server;
  /** The start-up recovery, then the lines and the scans; call once, before `listen`. */
  start(): void;
  /** Resolves with the port actually bound (0 asks the system for a free one). */
  listen(port: number, host?: string): Promise<number>;
  stop(graceMs?: number): Promise<void>;
}

/** Cards reach every open stream once their change has committed. */
function attachAskStreams(deps: AppDeps, presenter: Presenter): void {
  const { state, hub } = deps;
  presenter.attach({
    askCreated(ask, current) {
      hub.publish({ type: 'ask_created', ask: askView(state, ask), current, ...askBoard(deps) });
    },
    askAnswered(ask) {
      hub.publish({ type: 'ask_answered', ask: askView(state, ask), ...askBoard(deps) });
    },
    askUpdated(ask) {
      hub.publish({ type: 'ask_updated', ask: askView(state, ask), ...askBoard(deps) });
    },
  });
}

/** 现在摊开的那张卡、等你的有几张（卡事件里带着，界面不用再拉一次）。 */
export function askBoard(deps: Pick<AppDeps, 'desk'>): { currentId: string | null; waitingOnYouCount: number } {
  const board = deps.desk.board();
  return { currentId: board.current?.id ?? null, waitingOnYouCount: board.queue.length
    + (board.current === null ? 0 : 1) };
}

/** 记忆里在用的词表（生效的词语约定），给网页翻译当术语对照。 */
function glossaryTerms(state: StateService): GlossaryTerm[] {
  return allPages((page) => state.agreements.list({ state: 'active', kind: 'term' }, page))
    .map((term) => ({ term: term.title ?? '', meaning: term.text, scope: term.scope }))
    .filter((term) => term.term.trim() !== '');
}

/** 网页翻译缓存按模型分开：现在线上用的那个模型；还没选定（或测试里没装模型连接）记成 default，缓存要一个非空的名字。 */
function modelName(options: AppOptions): string {
  const kernel = options.kernelModels;
  const choice = kernel === undefined ? null : kernel.models.effective('translation');
  return choice === null ? 'default' : `${choice.provider}/${choice.model}/${choice.thinking}`;
}

export function createApp(options: AppOptions): App {
  const now = options.now ?? (() => new Date());
  const hub = options.hub ?? new EventHub();
  const stopSpaceEvents = options.state.spaces.subscribe((spaceId) => hub.publish({ type: 'space_changed', spaceId }));
  const bookInsights = new BookInsightService({
    state: options.state,
    now,
    changed: (bookId) => hub.publish({ type: 'book_changed', bookId, part: 'insights' }),
    model: { models: options.text },
  });
  bookInsights.recoverInterrupted();
  const translator = new PageTranslator({
    models: options.translateText ?? options.text,
    cache: options.state.translationCache,
    modelName: () => modelName(options),
    glossary: () => glossaryTerms(options.state),
    now,
  });
  // 直连（11-12）：握手答 answer、通道里的请求转给本机这个端口；开始听以后才有端口。
  let listeningPort: number | null = null;
  const direct = new DirectHub({ port: () => listeningPort });
  const devicePaths = new DevicePaths(direct.marker);
  const deps: AppDeps = {
    state: options.state,
    devicePaths,
    direct,
    text: options.text,
    bookInsights,
    noteAssistant: new NoteAssistant(options.text, options.state),
    translator,
    moneyDrafts: options.moneyDrafts,
    paymentReader: options.paymentReader,
    clientUpdates: options.clientUpdates,
    backups: options.backups,
    memoryCurator: options.memoryCurator,
    hub,
    desk: options.desk,
    push: options.push,
    sseHeartbeatMs: options.sseHeartbeatMs ?? SSE_HEARTBEAT_MS,
    pairingLimiter: new AttemptLimiter(PAIRING_FAILURE_LIMIT, PAIRING_FAILURE_WINDOW_MS, () => now().getTime()),
    passwordLimiter: new SourceLimiter({ perSource: PASSWORD_FAILURE_LIMIT, global: PASSWORD_GLOBAL_FAILURE_LIMIT,
      windowMs: PASSWORD_FAILURE_WINDOW_MS }, () => now().getTime()),
    localToken: options.localToken ?? null,
    now,
    daily: options.daily,
    scans: options.scans,
    devices: options.devices,
    startedAt: now().toISOString(),
    dryRun: options.dryRun,
    m5b: options.m5b,
    skills: options.skills,
    intake: options.intake,
    macDownloads: options.macDownloads ?? null,
    network: options.network,
    tunnel: options.tunnel ?? null,
    lines: options.lines,
    kernelModels: options.kernelModels ?? null,
    browserSessions: options.browserSessions ?? new BrowserSessions(options.state, now),
    tasks: options.tasks,
    video: options.video,
    heartbeat: options.heartbeat,
    calendar: options.calendar,
  };
  attachAskStreams(deps, options.presenter);
  attachFeedStreams(deps);
  attachDeviceStreams(deps);
  attachM5bStreams(deps);
  const api = createRequestHandler(deps);
  const server = createServer(options.clientDirectory === undefined ? api
    : withClientFiles(options.clientDirectory, api));
  const closed = new Promise<void>((resolve) => {
    server.on('close', () => resolve());
  });
  let stopping: Promise<void> | undefined;
  let started = false;

  return {
    deps,
    server,
    start() {
      if (started) {
        throw new Error('服务已经启动过了');
      }
      started = true;
      for (const attachment of options.state.attachments.recoverUploads()) {
        deps.hub.publish({ type: 'attachment_changed', attachment });
      }
      options.devices.recover();
      options.paymentReader.recover();
      options.moneyDrafts.purge();
      ensureDefaultProjects(options.state);
      // 记忆文档：「关于你」和每个项目的文档补齐；上次没做完的整理改回排队，扫描时接着做。
      ensureMemoryDocs(options.state);
      // 11-11：队友原来的自由文字 Soul 拆成只对它的规则（拆过的不再拆）。
      adoptMateSouls(options.state);
      options.memoryCurator.recover();
      // 第 113 条：加入了网络就开始收发；分身接着答重启前没答完的问题。
      options.network.start();
      // 隧道：解开的连接交给这个 HTTP 服务，和本机端口进来的一样处理。
      options.tunnel?.start((socket) => {
        deps.devicePaths.markTunnel(socket);
        server.emit('connection', socket);
      });
      // 新内核：在跑 / 在等的线接着跑，暂停的到点再跑，排着队的发出去。
      options.lines.start();
      // 定时线：先按现在的时区排好下一次（错过的补最近一次），再每分钟看一眼。
      options.tasks.start();
      options.video.start();
      // 本机备份：自己的定时器，每小时看一眼今天的那份做了没有。
      options.backups.start();
      options.clientUpdates.scan();
      options.scans.start();
    },
    listen(port, host = HOST) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const address = server.address();
          if (address === null || typeof address === 'string') {
            reject(new Error(`监听 ${host}:${port} 后拿不到端口`));
            return;
          }
          listeningPort = address.port;
          resolve(address.port);
        });
      });
    },
    stop(_graceMs = SHUTDOWN_GRACE_MS) {
      stopping ??= (async () => {
        const wasListening = server.listening;
        server.close();
        direct.close();
        stopSpaceEvents();
        options.scans.stop();
        options.tasks.stop();
        options.devices.stop();
        bookInsights.stop();
        options.memoryCurator.stop();
        // 第 113 条：先让同步循环停下（中止长轮询），免得它在关掉的服务上重连、记一条假的「连不上」。
        const networkStopped = options.network.stop();
        const tunnelStopped = options.tunnel?.stop() ?? Promise.resolve();
        options.paymentReader.stop();
        options.backups.stop();
        hub.closeAll();
        options.m5b.cloud.browser.close();
        options.kernelModels?.logins.stop();
        await Promise.all([options.lines.stop(), options.m5b.cloud.mailSync.stop(),
          options.daily.externalFeed?.stop(), options.daily.subscriptions.stop(), options.daily.comments?.stop(),
          options.daily.translations?.stop(), options.video.stop()]);
        await networkStopped;
        await tunnelStopped;
        await options.network.settled();
        await options.presenter.settled();
        await options.memoryCurator.settled();
        await options.paymentReader.settled();
        server.closeAllConnections();
        if (wasListening) {
          await closed;
        }
      })();
      return stopping;
    },
  };
}
