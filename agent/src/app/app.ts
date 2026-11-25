import { createServer, type Server } from 'node:http';
import { renderPage, type RenderFormat } from '../cloud-tools/index.ts';
import { adoptMateSouls } from '../mates/index.ts';
import { BookInsightService } from '../books/index.ts';
import { ComposePredictor } from '../loop/index.ts';
import { ensureDefaultProjects } from '../projects/index.ts';
import { ensureMemoryDocs, type MemoryCurator } from '../memory/index.ts';
import { NoteAssistant } from '../notes/index.ts';
import { YOU_DOC_ID } from '../../shared/state.ts';
import { PageTranslator, type GlossaryTerm } from '../web/index.ts';
import type { Diagnostics } from './diagnostics.ts';
import type { MoneyDraftDesk, PaymentReader } from '../life/index.ts';
import { Presence, type AskDesk, type Presenter, type PushService, type ScanScheduler } from '../attention/index.ts';
import type { Daily } from '../daily/index.ts';
import type { DeviceService } from '../devices/index.ts';
import type { Video } from '../video/index.ts';
import type { TextModels } from '../kernel/index.ts';
import type { LineKernel } from '../lines/index.ts';
import type { Tasks } from '../tasks/index.ts';
import type { CalendarSync } from '../calendar/index.ts';
import type { Heartbeat } from '../heartbeat/index.ts';
import type { NetworkService, TunnelService } from '../network/index.ts';
import type { SkillShop, SkillStore } from '../skills/index.ts';
import type { StateService } from '../state/index.ts';
import type { BackupService, ClientReleases, MigrationService } from '../system/index.ts';
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
import type { ToolGroupServices } from './tool-group-services.ts';
import { attachToolGroupStreams } from './tool-group-streams.ts';
import { withClientFiles } from './static-client.ts';
import type { KernelModelParts } from './model-providers.ts';
import { createRequestHandler } from './server.ts';
import { SourceLimiter } from './source-limiter.ts';
import { askView } from './asks.ts';
import { BrowserSessions } from './browser-sessions.ts';
import { DevicePaths } from './device-paths.ts';
import { DirectHub } from '../direct/index.ts';
import type { LineTimers } from '../timers/index.ts';

export interface AppOptions {
  state: StateService;
  diagnostics: Diagnostics;
  text: TextModels;
  publicUrl?: () => string;
  desk: AskDesk;
  presenter: Presenter;
  push: PushService;
  presence?: Presence;
  now?: () => Date;
  hub?: EventHub;
  sseHeartbeatMs?: number;
  daily: Daily;
  scans: ScanScheduler;
  devices: DeviceService;
  /** Development dry run of external effects (decisions 8 and 68). */
  dryRun: boolean;
  toolGroups: ToolGroupServices;
  moneyDrafts: MoneyDraftDesk;
  paymentReader: PaymentReader;
  clientUpdates: ClientReleases;
  backups: BackupService;
  migration?: MigrationService;
  skills: SkillStore;
  skillShop: SkillShop;
  memoryCurator: MemoryCurator;
  network: NetworkService;
  tunnel?: TunnelService;
  lines: LineKernel;
  kernelModels?: KernelModelParts;
  tasks: Tasks;
  lineTimers?: LineTimers;
  heartbeat: Heartbeat;
  calendar: CalendarSync;
  translateText?: TextModels;
  clientDirectory?: string;
  browserSessions?: BrowserSessions;
  video: Video;
  localToken?: string | null;
  renderPage?: (html: string, format: RenderFormat, signal: AbortSignal) => Promise<Buffer>;
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

export function askBoard(deps: Pick<AppDeps, 'desk'>): { currentId: string | null; waitingOnYouCount: number } {
  const board = deps.desk.board();
  return { currentId: board.current?.id ?? null, waitingOnYouCount: board.queue.length
    + (board.current === null ? 0 : 1) };
}

const TERM_LINE = /^「(?<term>[^」]{1,80})」\s*指的是\s*(?<meaning>.+)$/su;

function glossaryTerms(state: StateService): GlossaryTerm[] {
  return state.memoryDocs.lines.live(YOU_DOC_ID).flatMap((line) => {
    const found = TERM_LINE.exec(line.text.trim())?.groups;
    return found === undefined ? [] : [{ term: found['term']!.trim(), meaning: found['meaning']!.trim(), scope: '' }];
  }).filter((term) => term.term !== '');
}

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
  let listeningPort: number | null = null;
  const direct = new DirectHub({ port: () => listeningPort });
  const devicePaths = new DevicePaths(direct.marker);
  const deps: AppDeps = {
    state: options.state,
    diagnostics: options.diagnostics,
    devicePaths,
    direct,
    text: options.text,
    bookInsights,
    noteAssistant: new NoteAssistant(options.text, options.state),
    composePredictor: new ComposePredictor(options.text, options.state),
    translator,
    moneyDrafts: options.moneyDrafts,
    paymentReader: options.paymentReader,
    clientUpdates: options.clientUpdates,
    backups: options.backups,
    migration: options.migration ?? null,
    memoryCurator: options.memoryCurator,
    hub,
    desk: options.desk,
    push: options.push,
    presence: options.presence ?? new Presence(),
    sseHeartbeatMs: options.sseHeartbeatMs ?? SSE_HEARTBEAT_MS,
    pairingLimiter: new AttemptLimiter(PAIRING_FAILURE_LIMIT, PAIRING_FAILURE_WINDOW_MS, () => now().getTime()),
    passwordLimiter: new SourceLimiter({ perSource: PASSWORD_FAILURE_LIMIT, global: PASSWORD_GLOBAL_FAILURE_LIMIT,
      windowMs: PASSWORD_FAILURE_WINDOW_MS }, () => now().getTime()),
    localToken: options.localToken ?? null,
    renderPage: options.renderPage ?? ((html, format, signal) => renderPage(html, format, signal)),
    now,
    daily: options.daily,
    scans: options.scans,
    devices: options.devices,
    startedAt: now().toISOString(),
    dryRun: options.dryRun,
    toolGroups: options.toolGroups,
    skills: options.skills,
    skillShop: options.skillShop,
    network: options.network,
    tunnel: options.tunnel ?? null,
    lines: options.lines,
    kernelModels: options.kernelModels ?? null,
    browserSessions: options.browserSessions ?? new BrowserSessions(options.state, now),
    tasks: options.tasks,
    lineTimers: options.lineTimers ?? null,
    video: options.video,
    heartbeat: options.heartbeat,
    calendar: options.calendar,
  };
  attachAskStreams(deps, options.presenter);
  attachFeedStreams(deps);
  attachDeviceStreams(deps);
  attachToolGroupStreams(deps);
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
      ensureMemoryDocs(options.state);
      adoptMateSouls(options.state);
      options.memoryCurator.recover();
      options.network.start();
      options.tunnel?.start((socket) => {
        deps.devicePaths.markTunnel(socket);
        server.emit('connection', socket);
      });
      options.lines.start();
      options.tasks.start();
      options.lineTimers?.start();
      options.video.start();
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
        options.lineTimers?.stop();
        options.devices.stop();
        options.diagnostics.stop();
        bookInsights.stop();
        options.memoryCurator.stop();
        const networkStopped = options.network.stop();
        const tunnelStopped = options.tunnel?.stop() ?? Promise.resolve();
        options.paymentReader.stop();
        options.backups.stop();
        hub.closeAll();
        options.toolGroups.cloud.browser.close();
        options.kernelModels?.logins.stop();
        await Promise.all([options.lines.stop(), options.toolGroups.cloud.mailSync.stop(),
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
