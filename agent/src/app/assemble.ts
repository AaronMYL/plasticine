// The wiring of the whole service in one place, used by main.ts and by the tests alike. 2026-11-05 Harness 重做：对话就是
// 新内核的主线（lines/），要花时间的事开后台线；旧的对话轮、任务、事、自迭代、验收和它们的扫描都删了。这里装：卡桌和
// 它的推送、设备服务、云端工具与站内信、记账、信息流、图书、记忆整理、联系人与网络、进门的规则（命中开后台线）、
// 本机备份，以及新内核本身和它带的业务工具。

import {
  autoOnlyPermissionGate,
  createBookTools,
  createDeviceActionGate,
  createDeviceActionTool,
  createDeviceNodesTool,
  createFeedCommentGenerator,
  createFeedTranslator,
  createFeedSelector,
  createMemoryDocTools,
  createNoteTools,
  createPaymentTool,
  createServerCommandTools,
  createShowWidgetsTool,
  createSkillTools,
  getTimeTool,
  MemoryCurator,
  PaymentReader,
  projectTools,
  ToolRegistry,
  type Tool,
} from '../brain/index.ts';
import {
  AskDesk,
  Notices,
  Presenter,
  ProjectWatch,
  PushService,
  routeAsks,
  ScanScheduler,
  type AskResolver,
  type PushTransport,
  type VapidKeys,
} from '../attention/index.ts';
import { BACKGROUND_TIME_ZONE, createDaily, type FeedFetcher } from '../daily/index.ts';
import { DeviceService, type NodeTransport } from '../devices/index.ts';
import { bookmarkTrigger, contactTrigger, deviceTrigger, ensureIntake, feedTrigger, IntakeDesk, mailTrigger, ruleGoal,
  type RecordInput } from '../intake/index.ts';
import { kernelText, type TextModels } from '../kernel/index.ts';
import { MoneyDraftDesk } from '../life/index.ts';
import type { LineKernel } from '../lines/index.ts';
import { DEFAULT_RELAY_URL, NetworkService, TunnelService, type TunnelServiceOptions } from '../network/index.ts';
import { ServerCommands, type CloudTransports } from '../cloud-tools/index.ts';
import type { MailImageFetchOptions } from '../cloud-tools/mail-image-fetch.ts';
import type { FaviconFetchOptions } from '../cloud-tools/favicon-fetch.ts';
import { SkillStore } from '../skills/index.ts';
import { Tasks } from '../tasks/index.ts';
import { BackupService, ClientReleases } from '../system/index.ts';
import { MAIN_LINE_ID, type StateService } from '../state/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { join } from 'node:path';
import type { BackupObjectKind } from '../../shared/api/index.ts';
import { createApp, type App } from './app.ts';
import { agreementView, memoryEntryView } from './cognition-views.ts';
import { assembleLines, type LineAssembly } from './assemble-lines.ts';
import { publicUrlSource } from './public-url.ts';
import { publishNetworkChange } from './contact-streams.ts';
import { taskCardTool } from './task-card-tool.ts';
import { linePort } from './subscriptions.ts';
import { ensureReviewSubscription, SampleCards, subsTools } from '../subs/index.ts';
import { scanDiskNotice } from './disk-notice.ts';
import { reportAnnouncement } from './report-announcement.ts';
import { EventHub } from './event-hub.ts';
import { MAC_DOWNLOADS_DIR, MacDownloads } from './mac-updates.ts';
import { createM5bServices, m5bScans, m5bTools, toolEnabled } from './m5b-services.ts';
import { BrowserSessions } from './browser-sessions.ts';
import type { KernelModelParts } from './model-providers.ts';
import { createWidgetFacts } from './widget-facts.ts';
import { assembleTimed } from './assemble-timed.ts';
import { heartbeatChecklistTool } from '../heartbeat/index.ts';
import { cachedConflicts, CalendarSync, calendarTools } from '../calendar/index.ts';
import { interestHit } from '../../shared/feed-order.ts';
import { createVideo, publishToFeed, transcriberFromEnv, type Transcriber, type VideoMedia } from '../video/index.ts';
import { MAX_BACKGROUND_LINES } from '../lines/index.ts';

export interface AssembleOptions {
  state: StateService;
  publicUrl?: string;
  clientManifestPath?: string;
  /** 安装包：服务自己发的客户端构建目录（PLASTICINE_CLIENT_DIR，static-client.ts）。 */
  clientDirectory?: string;
  /** 内置技能目录（测试用；默认 agent/builtin-skills）。 */
  builtinSkills?: string;
  automaticBackups?: boolean;
  /** Development dry run of external effects (decision 8). */
  dryRun: boolean;
  vapidKeys: VapidKeys;
  vapidSubject: string;
  pushTransport?: PushTransport;
  now?: () => Date;
  hub?: EventHub;
  sseHeartbeatMs?: number;
  /** More tools for the registry (tests). */
  extraTools?: Tool[];
  /** How often the outer loop's scans run (attention/scheduler.ts SCAN_TICK_MS). */
  scanTickMs?: number;
  /** The state directory: files/, credentials/, cloud-tools/, downloads/, client-release.json. */
  stateDirectory: string;
  /** How device actions reach nodes (a fake in tests). */
  nodeTransport?: NodeTransport;
  /** How the cloud tools reach outside (tests give fakes; the default connects nothing). */
  cloudTransports?: Partial<CloudTransports>;
  /** 邮件图片代理怎么解析和核地址（测试给固定表）。 */
  mailImages?: MailImageFetchOptions;
  /** 网站图标代取怎么解析和核地址（测试给固定表）。 */
  favicons?: FaviconFetchOptions;
  /** Check credential files for 0600 even on Windows (tests). */
  checkCredentialMode?: boolean;
  feedFetcher?: FeedFetcher;
  /** 第 9 条：本地转写引擎（测试给假的）；不给按服务器环境变量（PLASTICINE_TRANSCRIBE_*），没配就是 null。 */
  transcriber?: Transcriber | null;
  /** 第 9 条：下载、抽音频（测试给假的）。 */
  videoMedia?: VideoMedia;
  /** 第 113 条：这台实例在网络上的那一头。 */
  network?: NetworkAssembly;
  /** 新内核（2026-11-05 Harness 重做）：线和它的模型。主对话就是主线。 */
  lines: LineAssembly;
  /** 旁路的模型调用（笔记、翻译、信息流、图书、记账截图、分身、记忆整理）；不给就用线的模型（kernel/text.ts）。 */
  text?: TextModels;
  /** 记忆后台整理（docs/specs/memory-docs.md 第 3 节）；false = 不整理（测试默认这样，免得假模型多收请求）。 */
  memoryCuration?: boolean;
  /** 新内核的模型连接（/v2/model-providers）；不给就不装（回 503）。 */
  kernelModels?: KernelModelParts;
  /** 桌面客户端给本体的本机令牌（PLASTICINE_LOCAL_TOKEN）；不给或 null = 不认本机令牌。 */
  localToken?: string | null;
}

export interface NetworkAssembly {
  /** PLASTICINE_NETWORK_URL；默认 https://cyberhunter.top。 */
  relayUrl?: string;
  /**
   * 2026-11-05：<handle>.cyberhunter.top 的隧道（main.ts 默认装，PLASTICINE_TUNNEL=0 不装：和中继在同一台
   * 机器上的实例走本机 Caddy）。不给就不装（测试）。
   */
  tunnel?: Omit<TunnelServiceOptions, 'stateDirectory' | 'relayUrl' | 'signer' | 'now'>;
  /** 加入以后自己长轮询收、发件箱自己发（线上默认开；测试关掉手动 syncOnce / flushOutbox）。 */
  autoSync?: boolean;
  pollWaitSeconds?: number;
  fetch?: typeof fetch;
  /** 替主人答话开不开线（新内核）；false = 不开（拿不准一律问主人）。线上默认开。 */
  responder?: boolean;
}

/** 新内核装好以前用到它的几处（网络开线、进门开线、设备授权的结果交回）：先占位，装好再接上。 */
class LateLines {
  #kernel: LineKernel | null = null;

  set(kernel: LineKernel): void {
    this.#kernel = kernel;
  }

  get(): LineKernel {
    if (this.#kernel === null) {
      throw new Error('新内核还没装好');
    }
    return this.#kernel;
  }
}

export function assembleApp(options: AssembleOptions): App {
  const { state } = options;
  const now = options.now ?? (() => new Date());
  const hub = options.hub ?? new EventHub();
  // 第 7 条（11-07 定）：个人回顾是一个订阅，日报每天早上 8 点、周报周日晚上，按他所在地的时区；没有就建上。
  ensureReviewSubscription(state, state.dailySettings.read().settings.timeZone ?? BACKGROUND_TIME_ZONE);
  const text = options.text ?? kernelText(options.lines.models, now);
  const server = new ServerCommands({ stateDirectory: options.stateDirectory, now });
  const skills = new SkillStore({ stateDirectory: options.stateDirectory, now,
    ...(options.builtinSkills === undefined ? {} : { builtinDirectory: options.builtinSkills }) });
  const fixedUrl = options.publicUrl;
  const publicUrl = fixedUrl === undefined ? publicUrlSource(state) : () => fixedUrl;
  const presenter = new Presenter(state);
  const desk = new AskDesk({ state, presenter, now });
  const late = new LateLines();
  // 进门（第 102 条）：来源记成触发，命中一条在用的规则就开一条后台线（贴回主对话）。
  ensureIntake(state);
  const intake = new IntakeDesk(state);
  intake.setHandlers({
    open: (trigger, rule) => {
      // 项目逾期 / 停滞的提醒信 ProjectWatch 已经直接发了，不再开线做同一件事。
      if (rule.code === 'project_overdue') {
        return null;
      }
      return late.get().open({ title: `${rule.name}：${trigger.summary}`.slice(0, 120), goal: ruleGoal(rule, trigger),
        projectId: null, parentLineId: MAIN_LINE_ID, origin: { kind: 'trigger', ref: trigger.id } }).id;
    },
  });
  const record = (input: RecordInput): void => {
    intake.record(input);
  };
  const backups = new BackupService({ state, desk, now, automatic: options.automaticBackups ?? true,
    restored: (kind, id) => publishRestored(state, hub, kind, id),
    changed: () => hub.publish({ type: 'backups_changed' }) });
  const transport = options.nodeTransport === undefined ? {} : { transport: options.nodeTransport };
  // 日历同步（第 15 条）后面才装好（时区跟着定时走）：Mac 一上线就叫它拉一次。
  let calendarSync: CalendarSync | null = null;
  const devices = new DeviceService({ state, now, desk, dryRun: options.dryRun, ...transport,
    cameOnline: (node, at) => {
      record(deviceTrigger({ nodeId: node.id, online: true, at, label: node.name }));
      calendarSync?.kick(true);
    } });
  devices.approvals?.onResult((result) => late.get().tell(result.lineId, result.text));
  const clientUpdates = new ClientReleases({ state, manifestPath: options.clientManifestPath ?? null,
    receiptPath: join(options.stateDirectory, 'client-release.json'),
    changed: () => hub.publish({ type: 'client_version_changed' }) });
  const browserSessions = new BrowserSessions(state, now);
  const m5b = createM5bServices({
    state,
    stateDirectory: options.stateDirectory,
    dryRun: options.dryRun,
    now,
    internalCookies: () => browserSessions.cookies(publicUrl()),
    // 云端浏览器认本实例页面用的地址：装配时取一次（入网后重启才换；它只用来把 #/ 地址认成站内页）。
    internalUrl: publicUrl(),
    ...(options.cloudTransports === undefined ? {} : { transports: options.cloudTransports }),
    ...(options.checkCredentialMode === undefined ? {} : { checkCredentialMode: options.checkCredentialMode }),
    ...(options.mailImages === undefined ? {} : { mailImages: options.mailImages }),
    ...(options.favicons === undefined ? {} : { favicons: options.favicons }),
    onMail: (message) => record(mailTrigger(message, { knownSender: state.inboxReplies.sentTo(message.fromAddress) })),
  });
  const moneyDrafts = new MoneyDraftDesk({ state, desk, money: m5b.life.money, now,
    changed: (id) => hub.publish({ type: 'money_draft_changed', draft: moneyDrafts.view(id) }),
    attachmentChanged: (id) => hub.publish({ type: 'attachment_changed',
      attachment: state.attachments.require(id) }) });
  const paymentReader = new PaymentReader({ state, drafts: moneyDrafts, models: text });
  const memoryCurator = new MemoryCurator({ state, now,
    model: options.memoryCuration === false ? null : { models: text } });
  let tunnel: TunnelService | undefined;
  const network = createNetwork(options, { state, now, desk, hub, text, late, record,
    joined: () => tunnel?.wake() });
  const tunnelSettings = options.network?.tunnel;
  if (tunnelSettings !== undefined) {
    tunnel = new TunnelService({ ...tunnelSettings, stateDirectory: options.stateDirectory,
      relayUrl: () => network.relayUrl(), signer: () => network.signer(), now });
  }
  // 第 9 条：视频解析。排进后台线的并发上限（3）里跑；总结好的抖音收藏进信息流。
  const video = createVideo({ state, now, stateDirectory: options.stateDirectory, text,
    transcriber: options.transcriber === undefined ? transcriberFromEnv(process.env) : options.transcriber,
    ...(options.videoMedia === undefined ? {} : { media: options.videoMedia }),
    slots: () => MAX_BACKGROUND_LINES
      - state.lines.withStatus(['running']).filter((line) => line.kind === 'background').length,
    interests: () => state.feedSources.all().filter((source) => source.kind === 'interest' && source.level !== 'off')
      .map((source) => source.label),
    summarized: (work) => {
      const zone = state.dailySettings.read().settings.timeZone ?? BACKGROUND_TIME_ZONE;
      const item = publishToFeed(state, work, now(), zone);
      if (item !== null) {
        daily.feed.announce(item);
      }
    },
    changed: () => hub.publish({ type: 'video_changed' }) });
  const registry = new ToolRegistry();
  const noteTools = createNoteTools(state, (noteId) => hub.publish({ type: 'note_invalidated', noteId }));
  const tools = [...noteTools, ...createBookTools(state), getTimeTool,
    createPaymentTool(moneyDrafts, paymentReader), createDeviceNodesTool(devices),
    createDeviceActionTool(devices.actions), ...m5bTools(m5b),
    ...projectTools({ state, changed: (projectId) => hub.publish({ type: 'project_invalidated', projectId }) }),
    ...createMemoryDocTools(state),
    ...createServerCommandTools(server), ...createSkillTools(skills),
    ...(options.extraTools ?? [])];
  for (const tool of tools) {
    registry.register(tool);
  }
  // 工具组：关掉的组，线上看不到它的工具（开关是用户确认字段，tool_groups）。
  registry.setGate((name) => toolEnabled(state, name)
    && (name !== 'cloud_ssh_run' || m5b.cloud.transportAvailable.ssh));
  // 任务栏目（《优化清单》第 3、4、5 条）：定时线就是一条后台线（不贴回哪条线，结果按卡上写的告诉他）；建议开始做的
  // 线做完贴回主线。线和通知后面才装好，这里按需取。
  const tasks = new Tasks({ state, now,
    scheduleLines: () => ({
      open: (input) => late.get().open({ ...input, parentLineId: null }).id,
      send: (lineId, text, origin) => {
        late.get().send(lineId, { text, origin });
      },
      view: (lineId) => (state.lines.get(lineId) === undefined ? null : late.get().view(lineId)),
      halt: (lineId) => {
        late.get().halt(lineId);
      },
    }),
    suggestionLines: () => ({ open: (input) => late.get().open({ ...input, parentLineId: MAIN_LINE_ID }).id }),
    notify: (notice) => {
      notices.post(notice);
    },
    changed: () => hub.publish({ type: 'tasks_changed' }),
    projectChanged: (projectId) => hub.publish({ type: 'project_invalidated', projectId }) });
  // 第 15 条：Apple 日历和提醒事项。Mac 在线时同步进缓存，首页「今天」、心跳的冲突检查读缓存。
  const calendarZone = (): string => tasks.schedules.timeZone();
  const calendar = new CalendarSync({ state, devices: devices.actions, now, zone: calendarZone,
    changed: () => hub.publish({ type: 'calendar_changed' }) });
  calendarSync = calendar;
  // 订阅、心跳、做梦登记进「定时」（第 6 批二段）：线、通知、项目查看后面才装好，按需取。
  const timed = assembleTimed({ state, now, hub, tasks, lines: () => late.get(), skills,
    calendar: cachedConflicts(state, calendarZone, now),
    text: options.memoryCuration === false ? null : text,
    notify: (input) => notices.post(input),
    stalled: (at) => projectWatch.stalled(at) });
  const permission = createDeviceActionGate(devices.actions, autoOnlyPermissionGate, devices.approvals);
  const lines = assembleLines(options.lines, { state, desk, hub, now, publicUrl,
    skillsContext: (lineId) => skills.context(`line:${lineId}`),
    lineChanged: (lineId) => network.lineChanged(lineId),
    tools: [taskCardTool(state, network), ...tasks.tools(), video.tool, heartbeatChecklistTool(() => timed.heartbeat),
      // 第 6、7 条：空间与订阅。订阅出一期要往后台线里放消息，线是下面这一行装出来的，所以晚取。
      ...subsTools(state, () => linePort(lines), now, (subscriptionId) => sampleCards.offer(subscriptionId)),
      ...calendarTools({ state, devices: devices.actions, sync: calendar, now, zone: calendarZone })],
    askTools: tasks.askTools(),
    legacy: { registry, permission, dryRun: options.dryRun, sshAvailable: m5b.cloud.transportAvailable.ssh,
      submits: devices.actions,
      widgets: (recorder) => createShowWidgetsTool(createWidgetFacts(state, m5b.life), recorder) },
    turnEnded: (line, outcome) => {
      // 旁聊和主线一样是他直接说话的地方（第 17 条）：聊出来的也进记忆整理。
      if (outcome === 'done' && line.kind !== 'background') {
        memoryCurator.enqueueLineTurn(line.id);
      }
      network.lineEnded(line.id, outcome);
      if (line.kind === 'background') {
        tasks.ended(line.id);
      }
    },
    // 贴回主线的后台线结果：没做成、没做完的再发一条系统通知；做成的只在主线上（11-07 他定「只在没做成时弹」）。
    reported: (report, parent) => {
      const announcement = parent.kind === 'main' ? reportAnnouncement(report) : null;
      if (announcement !== null) {
        notices.announce(announcement);
      }
    } });
  late.set(lines);
  const push = new PushService({
    state,
    keys: options.vapidKeys,
    subject: options.vapidSubject,
    now,
    ...(options.pushTransport === undefined ? {} : { transport: options.pushTransport }),
  });
  presenter.setNotifier(push);
  // 通知统一成「主线一条消息 + 系统通知」（《优化清单》第 12 条）：不再发任何通知邮件。
  // 第 7 批第 14 条：样刊出来附「开启定时 / 再改改」卡；确认写在主线上，「再改改」交给主线问他。
  const sampleCards = new SampleCards({ state, desk, notice: (input) => { lines.notice(input); },
    tell: (text) => { lines.tell(MAIN_LINE_ID, text); } });
  const notices = new Notices({ state, post: (input) => lines.notice(input), push, now });
  const daily = createDaily({ state, now,
    feedCommentGenerator: createFeedCommentGenerator(text),
    feedTranslator: createFeedTranslator(text),
    feedTranslatorModel: () => text.snapshot?.('translation').identity ?? null,
    onFeedItem: (item) => record(feedTrigger(item, interestHit(item))),
    onBookmark: (bookmark) => record(bookmarkTrigger(bookmark)),
    ...(options.feedFetcher === undefined ? {} : {
      externalFeed: { fetcher: options.feedFetcher, select: createFeedSelector(text) },
    }),
  });
  const resolvers: Partial<Record<string, AskResolver>> = {
    ...lines.resolvers(),
    subscription_schedule: sampleCards.resolver,
    money_confirmation: moneyDrafts.resolver,
    backup_restore: backups.resolver,
    ...network.resolvers(),
    ...(devices.approvals === undefined ? {} : { device_action: devices.approvals.resolver }),
  };
  desk.setResolver(routeAsks(resolvers, { resolve: () => undefined }));
  // 补发：还没开定时、已经出过样刊的订阅（11-08 他那份周报），最新那一期没出过卡的补一张。同一期不会出第二张。
  try {
    sampleCards.backfill();
  } catch (error) {
    safeLog('error', 'sample_card_backfill_failed', { category: errorCategory(error), error });
  }
  const scans = new ScanScheduler(options.scanTickMs === undefined ? {} : { tickMs: options.scanTickMs });
  // 项目（用户 2026-11-01 定）：每周现状、逾期与停滞提醒（主线通知）。
  const projectWatch = new ProjectWatch({ state, now,
    timeZone: BACKGROUND_TIME_ZONE,
    changed: (projectId) => hub.publish({ type: 'project_invalidated', projectId }) });
  scans.add({ name: '项目现状与逾期', run: () => projectWatch.scan() });
  // 记忆整理（用户 2026-11-02 定）：补建文档、重试失败的整理、排下一批旧条目迁移。
  scans.add({ name: '记忆整理', run: () => memoryCurator.scan() });
  scans.add({ name: '磁盘空间', run: () => scanDiskNotice({ notices, directory: options.stateDirectory, now }) });
  scans.add({ name: '已记账原图清理', run: () => moneyDrafts.purge() });
  scans.add({ name: '客户端发布记录', run: () => clientUpdates.scan() });
  scans.add({ name: '日历同步', run: () => calendar.scan() });
  for (const scan of [...daily.scans, ...video.scans, ...m5bScans(m5b)]) {
    scans.add(scan);
  }
  return createApp({
    browserSessions,
    m5b,
    memoryCurator,
    skills,
    moneyDrafts,
    paymentReader,
    clientUpdates,
    backups,
    daily,
    scans,
    state,
    text,
    publicUrl,
    desk,
    presenter,
    push,
    now,
    hub,
    ...(options.sseHeartbeatMs === undefined ? {} : { sseHeartbeatMs: options.sseHeartbeatMs }),
    devices,
    dryRun: options.dryRun,
    intake,
    macDownloads: new MacDownloads({ directory: join(options.stateDirectory, MAC_DOWNLOADS_DIR), publicUrl }),
    network,
    lines,
    tasks,
    video,
    heartbeat: timed.heartbeat,
    calendar,
    ...(tunnel === undefined ? {} : { tunnel }),
    ...(options.kernelModels === undefined ? {} : { kernelModels: options.kernelModels }),
    ...(options.clientDirectory === undefined ? {} : { clientDirectory: options.clientDirectory }),
    localToken: options.localToken ?? null,
  });
}

/** 按对象恢复提交以后告诉打开的页面：笔记只带身份（各设备按自己的解锁状态重读），约定、旧记忆条目带新样子。 */
function publishRestored(state: StateService, hub: EventHub, kind: BackupObjectKind, id: string): void {
  if (kind === 'note') {
    hub.publish({ type: 'note_invalidated', noteId: id });
  } else if (kind === 'agreement') {
    hub.publish({ type: 'agreement_changed', agreement: agreementView(state.agreements.require(id)) });
  } else {
    hub.publish({ type: 'memory_entry_changed', entry: memoryEntryView(state.memory.require(id)) });
  }
}

interface NetworkParts {
  state: StateService;
  now: () => Date;
  desk: AskDesk;
  hub: EventHub;
  text: TextModels;
  late: LateLines;
  record: (input: RecordInput) => void;
  /** 加入网络以后（叫醒隧道）。 */
  joined: () => void;
}

/** 第 113 条：联系人与网络。进来的人话、AI 话记成来源；「让 Plasticine 做」开一条后台线；改动提交以后推给界面。 */
function createNetwork(options: AssembleOptions, parts: NetworkParts): NetworkService {
  const { state, hub, late } = parts;
  const settings = options.network ?? {};
  const network: NetworkService = new NetworkService({
    state,
    now: parts.now,
    desk: parts.desk,
    lines: {
      open: (input, after) => late.get().open({ title: input.title, goal: input.goal, projectId: null,
        parentLineId: null, origin: { kind: 'network' },
        ...(input.sealedPrompt === undefined ? {} : { sealedPrompt: input.sealedPrompt }) },
      after).id,
      send: (lineId, text, after) => {
        late.get().send(lineId, { text, origin: { kind: 'network' } }, after);
      },
      answer: (lineId) => late.get().answer(lineId),
      status: (lineId) => late.get().status(lineId),
      activity: (lineId) => late.get().activity(lineId),
      execution: (lineId) => {
        if (late.get().status(lineId) === null) {
          return null;
        }
        const { status, pauseReason, outcome, pausedUntil, failure, queued } = late.get().view(lineId);
        return { status, pauseReason, outcome, pausedUntil, failure, queued };
      },
      halt: (lineId) => {
        late.get().halt(lineId);
      },
      settled: () => late.get().settled(),
    },
    relayUrl: settings.relayUrl ?? DEFAULT_RELAY_URL,
    autoSync: settings.autoSync ?? true,
    ...(settings.pollWaitSeconds === undefined ? {} : { pollWaitSeconds: settings.pollWaitSeconds }),
    ...(settings.fetch === undefined ? {} : { fetch: settings.fetch }),
    responder: settings.responder !== false,
    recordSource: (message, contact) => parts.record(contactTrigger(message, contact)),
    changed: (change) => publishNetworkChange({ state, hub, activity: (task) => network.taskActivity(task),
      execution: (task) => network.taskExecution(task) }, change),
    onJoined: parts.joined,
  });
  return network;
}
