import type { RenderFormat } from '../cloud-tools/index.ts';
import type { Diagnostics } from './diagnostics.ts';
import type { Video } from '../video/index.ts';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import type { Device, Session } from '../../shared/state.ts';
import type { AskDesk, Presence, PushService, ScanScheduler } from '../attention/index.ts';
import type { BookInsightService } from '../books/index.ts';
import type { ComposePredictor } from '../loop/index.ts';
import type { MemoryCurator } from '../memory/index.ts';
import type { NoteAssistant } from '../notes/index.ts';
import type { PageTranslator } from '../web/index.ts';
import type { MoneyDraftDesk, PaymentReader } from '../life/index.ts';
import type { Daily } from '../daily/index.ts';
import type { DeviceService } from '../devices/index.ts';
import type { TextModels } from '../kernel/index.ts';
import type { LineKernel } from '../lines/index.ts';
import type { NetworkService, TunnelService } from '../network/index.ts';
import type { SkillShop, SkillStore } from '../skills/index.ts';
import type { StateService } from '../state/index.ts';
import type { BackupService, ClientReleases, MigrationService } from '../system/index.ts';
import type { AttemptLimiter } from './attempt-limiter.ts';
import type { SourceLimiter } from './source-limiter.ts';
import { ApiError, unauthorized } from './api-error.ts';
import type { EventHub } from './event-hub.ts';
import type { ToolGroupServices } from './tool-group-services.ts';
import type { KernelModelParts } from './model-providers.ts';
import type { BrowserSessions } from './browser-sessions.ts';
import type { Tasks } from '../tasks/index.ts';
import type { CalendarSync } from '../calendar/index.ts';
import type { Heartbeat } from '../heartbeat/index.ts';
import type { DevicePaths } from './device-paths.ts';
import type { DirectHub } from '../direct/index.ts';
import type { LineTimers } from '../timers/index.ts';

export interface AppDeps {
  state: StateService;
  diagnostics: Diagnostics;
  devicePaths: DevicePaths;
  direct: DirectHub;
  text: TextModels;
  noteAssistant: NoteAssistant;
  composePredictor: ComposePredictor;
  translator: PageTranslator;
  bookInsights: BookInsightService;
  paymentReader: PaymentReader;
  moneyDrafts: MoneyDraftDesk;
  clientUpdates: ClientReleases;
  backups: BackupService;
  migration: MigrationService | null;
  memoryCurator: MemoryCurator;
  hub: EventHub;
  desk: AskDesk;
  push: PushService;
  presence: Presence;
  /** How often an open event stream re-checks its session and sends a keep-alive (config.ts SSE_HEARTBEAT_MS). */
  sseHeartbeatMs: number;
  /** Wrong node pairing codes, counted across all callers. */
  pairingLimiter: AttemptLimiter;
  passwordLimiter: SourceLimiter;
  localToken: string | null;
  renderPage: (html: string, format: RenderFormat, signal: AbortSignal) => Promise<Buffer>;
  now: () => Date;
  daily: Daily;
  /** The outer loop's timed scans (feed, mail, memory curation, projects …). */
  scans: ScanScheduler;
  /** M5: execution nodes (device service). */
  devices: DeviceService;
  startedAt: string;
  /** Development dry run of external effects (decisions 8 and 68). */
  dryRun: boolean;
  toolGroups: ToolGroupServices;
  skills: SkillStore;
  skillShop: SkillShop;
  network: NetworkService;
  tunnel: TunnelService | null;
  lines: LineKernel;
  kernelModels: KernelModelParts | null;
  browserSessions: BrowserSessions;
  tasks: Tasks;
  lineTimers: LineTimers | null;
  video: Video;
  heartbeat: Heartbeat;
  calendar: CalendarSync;
}

export interface AuthContext {
  session: Session;
  device: Device;
  actor?: 'user' | 'system';
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Readonly<Record<string, string>>;
  auth: AuthContext | null;
  deps: AppDeps;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: OutgoingHttpHeaders;
  /** Sent as is instead of JSON (pictures; a file of the files page with `download` set). */
  bytes?: { data: Buffer; type: string; download?: string; noStore?: boolean };
}

/** `streamed`: the handler wrote the response itself (the SSE stream). */
export type HandlerResult = Reply | 'streamed';
export type Handler = (context: RequestContext) => HandlerResult | Promise<HandlerResult>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Route {
  method: HttpMethod;
  /** `/v2/notes/:id`: a `:name` segment matches one path segment and becomes `params.name`. */
  path: string;
  /** False only for logging in and the health check; every other route answers 401 without a session. */
  auth: boolean;
  node?: boolean;
  handler: Handler;
  longPoll?: boolean;
}

export function requireAuth(context: RequestContext): AuthContext {
  if (context.auth === null) {
    throw unauthorized();
  }
  return context.auth;
}

export function requireUserAuth(context: RequestContext): AuthContext {
  const auth = requireAuth(context);
  if (auth.actor === 'system') {
    throw new ApiError(403, 'user_confirmation_required', '这一步代表你本人，需要在你的 Plasticine 页面操作。',
      { next: 'Plasticine 请使用已有的 AI 工具；需要本人回答或确认时交回用户。' });
  }
  return auth;
}

export function param(context: RequestContext, name: string): string {
  const value = context.params[name];
  if (value === undefined) {
    throw new Error(`路由没有参数 ${name}`);
  }
  return value;
}
