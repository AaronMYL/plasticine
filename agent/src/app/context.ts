// The shapes every resource file shares: what the service is built from, what a handler gets, what it returns.

import type { Video } from '../video/index.ts';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import type { Device, Session } from '../../shared/state.ts';
import type { AskDesk, Presence, PushService, ScanScheduler } from '../attention/index.ts';
import type { BookInsightService, ComposePredictor, MemoryCurator, NoteAssistant, PageTranslator, PaymentReader }
  from '../brain/index.ts';
import type { Daily } from '../daily/index.ts';
import type { DeviceService } from '../devices/index.ts';
import type { IntakeDesk } from '../intake/index.ts';
import type { TextModels } from '../kernel/index.ts';
import type { MoneyDraftDesk } from '../life/index.ts';
import type { LineKernel } from '../lines/index.ts';
import type { NetworkService, TunnelService } from '../network/index.ts';
import type { SkillShop, SkillStore } from '../skills/index.ts';
import type { StateService } from '../state/index.ts';
import type { BackupService, ClientReleases } from '../system/index.ts';
import type { AttemptLimiter } from './attempt-limiter.ts';
import type { SourceLimiter } from './source-limiter.ts';
import { ApiError, unauthorized } from './api-error.ts';
import type { EventHub } from './event-hub.ts';
import type { M5bServices } from './m5b-services.ts';
import type { MacDownloads } from './mac-updates.ts';
import type { KernelModelParts } from './model-providers.ts';
import type { BrowserSessions } from './browser-sessions.ts';
import type { Tasks } from '../tasks/index.ts';
import type { CalendarSync } from '../calendar/index.ts';
import type { Heartbeat } from '../heartbeat/index.ts';
import type { DevicePaths } from './device-paths.ts';
import type { DirectHub } from '../direct/hub.ts';

export interface AppDeps {
  state: StateService;
  /** 登录着的设备这次怎么连进来的（本机 / 直连 / 经中继 / 自己的网址），只在内存里。 */
  devicePaths: DevicePaths;
  /** 直连的握手和通道（direct/hub.ts）。 */
  direct: DirectHub;
  /** 旁路的模型调用（kernel/text.ts）：笔记、翻译、图书、记账截图、分身、记忆整理。 */
  text: TextModels;
  noteAssistant: NoteAssistant;
  /** 预测消息（11-13）：对话和消息输入框里的输入建议。 */
  composePredictor: ComposePredictor;
  /** 网页翻译（2026-11-03 沉浸式翻译）：段落 → 译文，查缓存、排前台。 */
  translator: PageTranslator;
  /** 图书的大纲与重点（2026-11-01）。 */
  bookInsights: BookInsightService;
  paymentReader: PaymentReader;
  moneyDrafts: MoneyDraftDesk;
  clientUpdates: ClientReleases;
  backups: BackupService;
  memoryCurator: MemoryCurator;
  hub: EventHub;
  desk: AskDesk;
  push: PushService;
  /** 第13批：哪台设备正开着哪段对话（新消息通知不打扰他正看着的那段）。 */
  presence: Presence;
  /** How often an open event stream re-checks its session and sends a keep-alive (config.ts SSE_HEARTBEAT_MS). */
  sseHeartbeatMs: number;
  /** Wrong node pairing codes, counted across all callers. */
  pairingLimiter: AttemptLimiter;
  /** 密码、建账号链接输错（2026-11-08）：按来源和全部来源一起数。 */
  passwordLimiter: SourceLimiter;
  /** 桌面客户端给本体的本机令牌（PLASTICINE_LOCAL_TOKEN）；没设是 null（服务器上的实例都是）。 */
  localToken: string | null;
  now: () => Date;
  /** M4: 信息流、关注点、书签. */
  daily: Daily;
  /** The outer loop's timed scans (feed, mail, memory curation, projects …). */
  scans: ScanScheduler;
  /** M5: execution nodes (device service). */
  devices: DeviceService;
  /** When this process started (设置 · 系统). */
  startedAt: string;
  /** Development dry run of external effects (decisions 8 and 68). */
  dryRun: boolean;
  /** M5 乙路: 记账、云端工具、文件页、站内信. */
  m5b: M5bServices;
  skills: SkillStore;
  /** 技能页的「添加」：商店清单、从网址、从文件（11-13）。 */
  skillShop: SkillShop;
  /** 第 102 条：进门（来源记成触发，命中规则开后台线）。 */
  intake: IntakeDesk;
  /** 第 102 条：Mac 自更新的包（状态目录 downloads/mac/）；没装配就是 null，接口回 404。 */
  macDownloads: MacDownloads | null;
  /** 第 113 条：这台实例在 Cyber Hunter 网络上的那一头（network/）。 */
  network: NetworkService;
  /** <handle>.cyberhunter.top 的隧道；和中继同机的实例、测试没装是 null。 */
  tunnel: TunnelService | null;
  /** 新内核（2026-11-05 Harness 重做）：线。主对话是主线。 */
  lines: LineKernel;
  /** 新内核的模型连接（kernel/）：提供商一律平级，按 provider id 登录、填 key、选默认。没装配是 null。 */
  kernelModels: KernelModelParts | null;
  browserSessions: BrowserSessions;
  /** 任务栏目（《优化清单》第 3、4、5 条）：定时线、照卡发送、建议、定时登记和队友。 */
  tasks: Tasks;
  /** 第 6 批第 9 条：视频解析与抖音收藏。 */
  video: Video;
  /** 心跳（《优化清单》第 11 条）。 */
  heartbeat: Heartbeat;
  /** 第 15 条：Apple 日历和提醒事项的缓存同步（首页「今天」打开时叫一次）。 */
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
  handler: Handler;
}

export function requireAuth(context: RequestContext): AuthContext {
  if (context.auth === null) {
    throw unauthorized();
  }
  return context.auth;
}

/** 明确代表本人发话或作答的入口，内部浏览器不能借用个人身份；已有 AI 工具照常走自身来源。 */
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
