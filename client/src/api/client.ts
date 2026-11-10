import type { NetworkAttachmentsApi } from './network-attachments-client.ts';
// 客户端用到的接口函数签名（前缀 /v2/，《实施方案》第 5 节）。http/ 的真实现和 fake/ 的内存实现都满足它；
// 组件不直接 fetch，只经 useApi() 拿到这个对象。请求和响应的形状都是 agent/shared/api 里的。

import type { ContactsClientApi } from './contacts-client.ts';
import type { M5bApi } from './m5b-client.ts';
import type { ThingsApi } from './things-client.ts';
import type {
  Backup,
  BackupDetail,
  BackupList,
  CreateBackupRequest,
  RestorePreviewRequest,
  RestorePreview,
} from './shared.ts';
export interface BackupsApi {
  list(signal?: AbortSignal): Promise<BackupList>;
  get(id: string, signal?: AbortSignal): Promise<BackupDetail>;
  create(input: CreateBackupRequest): Promise<Backup>;
  preview(id: string, input: RestorePreviewRequest): Promise<RestorePreview>;
  getPreview(id: string, signal?: AbortSignal): Promise<RestorePreview>;
}
import type {
  ClientUpdatesResponse,
  ClientUpdateDecision,
  ClientUpdate,
} from './shared.ts';
export interface ClientUpdatesApi {
  list(signal?: AbortSignal): Promise<ClientUpdatesResponse>;
  decide(id: string, input: ClientUpdateDecision): Promise<ClientUpdate>;
}
import type {
  AttachmentView,
  UploadAttachmentRequest,
} from './shared.ts';
import type {
  MoneyDraftView,
  CreateMoneyDraftRequest,
  EditMoneyDraftRequest,
  RejectMoneyDraftRequest,
  MoneyDraftSummary,
  PurgeOriginalsRequest,
  PurgeOriginalsResponse,
} from './shared.ts';

export interface MoneyDraftsApi {
  create(input: CreateMoneyDraftRequest): Promise<MoneyDraftView>;
  get(id: string, signal?: AbortSignal): Promise<MoneyDraftView>;
  edit(id: string, input: EditMoneyDraftRequest): Promise<MoneyDraftView>;
  reject(id: string, input: RejectMoneyDraftRequest): Promise<MoneyDraftView>;
  /** 《置信度与做事方式改动方案》第二批：截图记账的每周汇总，和一键清掉已记账的原图。 */
  summary(signal?: AbortSignal): Promise<MoneyDraftSummary>;
  purgeOriginals(input: PurgeOriginalsRequest): Promise<PurgeOriginalsResponse>;
}

export interface AttachmentsApi {
  text(id: string, signal?: AbortSignal): Promise<import('./shared.ts').AttachmentTextView>;
  lookup(requestId: string, signal?: AbortSignal): Promise<AttachmentView | null>;
  upload(input: UploadAttachmentRequest, signal?: AbortSignal, onProgress?: (fraction: number) => void):
    Promise<AttachmentView>;
  get(id: string, signal?: AbortSignal): Promise<AttachmentView>;
  contentUrl(id: string): string;
  content(id: string, signal?: AbortSignal): Promise<Blob>;
}
import type {
  PushStatus,
} from './shared.ts';
import type { SignedResult, SignedSend, SignedTarget } from './signed-targets.ts';
import type {
  AddFeedItemRequest,
  BriefItemView,
  DailySettingsView,
  FeedItemView,
  FeedListQuery,
  FeedListResponse,
  FeedSourceView,
  FeedSourcesResponse,
  NodeActionView,
  NodeListResponse,
  NodeView,
  RevokeNodeRequest,
  ReactFeedItemRequest,
  ReadReturnBriefRequest,
  ReturnBriefView,
  SaveFeedItemRequest,
  SeeBriefItemRequest,
  SetSourceLevelRequest,
  UpdateDailySettingsRequest,
} from './types.ts';
import type {
  AgreementDetail,
  AgreementListQuery,
  AgreementListResponse,
  DeviceKeyView,
  MemoryBoardQuery,
  MemoryBoardResponse,
  MemoryColumn,
  MemoryEntriesQuery,
  MemoryEntryDetail,
  MemoryEntryView,
  AnswerAskRequest,
  AnswerAskResponse,
  AskAboutRequest,
  AskAboutResponse,
  AskListResponse,
  AskView,
  CreateNoteRequest,
  DeferAskRequest,
  DeferAskResponse,
  DeviceView,
  EventHandlers,
  NoteMetaView,
  NoteSearch,
  NoteView,
  PushKeyResponse,
  SaveNoteRequest,
  SessionView,
  SubscribePushRequest,
  SubscribePushResponse,
  UnsubscribePushRequest,
  UnsubscribePushResponse,
} from './types.ts';

export interface SessionApi {
  /** GET /v2/session：当前会话；没有会话时返回 null（不抛 401）。 */
  current(signal?: AbortSignal): Promise<SessionView | null>;
  // 11-08 去掉配对码：登录在 account-client.ts（@账号 + 密码、本机令牌）。
  /** DELETE /v2/session */
  logout(): Promise<void>;
}

export interface DevicesApi {
  /** GET /v2/devices：配对过的设备，撤销过的也在。 */
  list(signal?: AbortSignal): Promise<DeviceView[]>;
  /** DELETE /v2/devices/:id：撤销一台设备，它的会话一起失效；撤销两次结果一样。 */
  revoke(id: string): Promise<DeviceView>;
}

export interface NotesApi {
  batch(input: import('./shared.ts').NotesBatchRequest): Promise<import('./shared.ts').BatchResponse>;
  emptyTrash(input: import('./shared.ts').EmptyTrashRequest): Promise<import('./shared.ts').BatchResponse>;
  folders(signal?: AbortSignal): Promise<import('./shared.ts').NoteFoldersView>;
  changeFolder(input: import('./shared.ts').NoteFolderCommand): Promise<import('./shared.ts').NoteFoldersView>;
  restore(id: string, requestId: string): Promise<NoteView>;
  uploadImage(id: string, input: import('./shared.ts').NoteImageRequest,
    signal?: AbortSignal): Promise<import('./shared.ts').NoteImageView>;
  assist(id: string, input: import('./shared.ts').NoteAssistRequest,
    signal?: AbortSignal): Promise<import('./shared.ts').NoteAssistView>;
  /**
   * 同一个接口带 stream: true（续写边生成边显示，2026-11-09）：onText 每到一段调一次，返回最终文字，以它为准
   * （拼起来的增量是它的开头，结尾可能少一点）。
   */
  assistStream(id: string, input: import('./shared.ts').NoteAssistRequest, onText: (delta: string) => void,
    signal?: AbortSignal): Promise<import('./shared.ts').NoteAssistView>;
  imported(id: string, signal?: AbortSignal): Promise<import('./shared.ts').NoteImportView>;
  /** GET /v2/notes：服务端正文搜索，翻完匹配结果的所有页。 */
  list(query: NoteSearch, signal?: AbortSignal): Promise<NoteMetaView[]>;
  /** GET /v2/notes/:id */
  get(id: string, signal?: AbortSignal): Promise<NoteView>;
  /** POST /v2/notes */
  create(input: CreateNoteRequest): Promise<NoteView>;
  /** PUT /v2/notes/:id：带 version；版本不符抛 NoteConflictError（409，带服务端当前那一版）。 */
  save(id: string, input: SaveNoteRequest): Promise<NoteView>;
  /** DELETE /v2/notes/:id：移到「最近删除」，不是永久删除。 */
  remove(id: string, requestId: string): Promise<NoteView>;
}

export interface AsksApi {
  feedback(id: string, input: import('./types.ts').AskFeedbackRequest): Promise<AskView>;
  /** GET /v2/asks：现在摊开的一张和排队的。 */
  list(signal?: AbortSignal): Promise<AskListResponse>;
  /** GET /v2/asks/:id */
  get(id: string, signal?: AbortSignal): Promise<AskView>;
  /** POST /v2/asks/:id/answer：带 requestId；已答或已撤回是 409 ask_closed。 */
  answer(id: string, input: AnswerAskRequest): Promise<AnswerAskResponse>;
  /** POST /v2/asks/:id/defer：先不，收回清单，不算答。 */
  defer(id: string, input: DeferAskRequest): Promise<DeferAskResponse>;
  /** POST /v2/asks/:id/ask：问一句，引用这张卡开一轮对话，卡留着。 */
  ask(id: string, input: AskAboutRequest): Promise<AskAboutResponse>;
}

export interface PushApi {
  status(signal?: AbortSignal): Promise<PushStatus>;
  /** GET /v2/push/key：VAPID 公钥。 */
  key(signal?: AbortSignal): Promise<PushKeyResponse>;
  /** POST /v2/push/subscriptions：把这台设备的推送订阅交给服务端（同一个 endpoint 只留一行）。 */
  subscribe(input: SubscribePushRequest): Promise<SubscribePushResponse>;
  /** DELETE /v2/push/subscriptions：退订。 */
  unsubscribe(input: UnsubscribePushRequest): Promise<UnsubscribePushResponse>;
}

export interface MemoryApi {
  /** GET /v2/memory/entries/:id：一条整理前的原话（只读，引用里的原话出处用）。 */
  entry(id: string, signal?: AbortSignal): Promise<MemoryEntryDetail>;
}

export interface AgreementsApi {
  create(input: import('./shared.ts').CreateTermRequest): Promise<import('./shared.ts').AgreementView>;
  propose(id: string, input: import('./shared.ts').ProposeTermRequest): Promise<import('./shared.ts').AgreementView>;
  decodings(id: string, signal?: AbortSignal): Promise<import('./shared.ts').TermDecodingList>;
  /** GET /v2/agreements?offset=：约定栏往后翻一页（第一页在 /v2/memory 里）。 */
  list(query: AgreementListQuery, signal?: AbortSignal): Promise<AgreementListResponse>;
  /** GET /v2/agreements/:id */
  get(id: string, signal?: AbortSignal): Promise<AgreementDetail>;
}

export interface DeviceKeysApi {
  /** GET /v2/device-keys：这台设备登记过的签名公钥，没有是 null。 */
  current(signal?: AbortSignal): Promise<DeviceKeyView | null>;
  /**
   * POST /v2/device-keys：bodyText 是原样的请求体（requestId + 公钥 JWK）。服务端按请求体摘要去重，回执丢了重发
   * 要一字不差。配对超过 10 分钟是 403 device_key_too_late，已有另一把是 409 device_key_exists。
   */
  register(bodyText: string): Promise<DeviceKeyView>;
}

export interface SignedApi {
  lookup(requestId: string, target: SignedTarget): Promise<SignedResult | null>;
  /** 本人确认的写操作（授权设备动作、恢复备份、确认记忆等）；旧 note_unlock 仅保留读取兼容。 */
  send(request: SignedSend): Promise<SignedResult>;
}

export interface ProjectsApi {
  /** GET /v2/projects?tz=&includeDone=：常驻的 Plasticine、个人排最后。 */
  list(query: import('./shared.ts').ProjectQuery, signal?: AbortSignal):
    Promise<import('./shared.ts').ProjectListResponse>;
  /** GET /v2/projects/:id?tz=：全貌、待办、线、资料、动态、档案、分工。 */
  get(id: string, query: import('./shared.ts').ProjectQuery, signal?: AbortSignal):
    Promise<import('./shared.ts').ProjectDetail>;
  create(input: import('./shared.ts').CreateProjectRequest): Promise<import('./shared.ts').ProjectRowView>;
  /** PUT /v2/projects/:id：带 version；版本旧了抛 ConflictError。 */
  edit(id: string, input: import('./shared.ts').EditProjectRequest): Promise<import('./shared.ts').ProjectRowView>;
  /** POST /v2/projects/:id/health：只有用户写健康度（采纳提议或另选一档）。 */
  setHealth(id: string, input: import('./shared.ts').SetProjectHealthRequest):
    Promise<import('./shared.ts').ProjectRowView>;
  file(id: string, input: import('./shared.ts').FileProjectItemRequest): Promise<import('./shared.ts').ProjectRowView>;
  unfile(id: string, input: import('./shared.ts').UnfileProjectItemRequest):
    Promise<import('./shared.ts').ProjectRowView>;
  /** POST /v2/projects/:id/todos：加一条待办（可带期限）。 */
  addTodo(id: string, input: import('./shared.ts').AddProjectTodoRequest):
    Promise<import('./shared.ts').ProjectTodoResponse>;
  /** PUT /v2/projects/:id/todos/:todoId：改标题、期限，勾上或取消做完。 */
  editTodo(id: string, todoId: string, input: import('./shared.ts').EditProjectTodoRequest):
    Promise<import('./shared.ts').ProjectTodoResponse>;
}

export interface TodayApi {
  /** GET /v2/today/settings */
  settings(signal?: AbortSignal): Promise<DailySettingsView>;
  /** PUT /v2/today/settings：离开多久算回来等日常设置；带 version。 */
  saveSettings(input: UpdateDailySettingsRequest): Promise<DailySettingsView>;
  /** GET /v2/calendar/today：首页「今天」（第 15 条，Apple 日历和提醒事项的缓存）。 */
  calendar(query: import('./shared.ts').CalendarTodayQuery, signal?: AbortSignal):
    Promise<import('./shared.ts').CalendarTodayView>;
}

export interface FeedApi {
  /** GET /v2/feed/items/:id：读取指定条目，不受当前列表筛选影响。 */
  get(id: string, signal?: AbortSignal): Promise<FeedItemView>;
  refresh(input: import('./shared.ts').RefreshFeedRequest): Promise<import('./shared.ts').FeedRefresh>;
  refreshStatus(requestId: string, signal?: AbortSignal): Promise<import('./shared.ts').FeedRefresh>;
  comments(id: string, signal?: AbortSignal): Promise<import('./shared.ts').FeedCommentsResponse>;
  comment(id: string, input: import('./shared.ts').AddFeedCommentRequest):
    Promise<import('./shared.ts').FeedCommentsResponse>;
  retryComment(id: string, commentId: string, input: import('./shared.ts').RetryFeedCommentRequest):
    Promise<import('./shared.ts').FeedCommentsResponse>;
  addInterest(input: import('./shared.ts').AddInterestRequest): Promise<import('./shared.ts').InterestResponse>;
  blockSite(input: import('./shared.ts').BlockFeedSiteRequest): Promise<FeedSourceView>;
  setSourceQuery(id: string, input: import('./shared.ts').SetSourceQueryRequest): Promise<FeedSourceView>;
  subscribe(input: import('./shared.ts').AddSubscriptionRequest): Promise<FeedSourceView>;
  /** GET /v2/feed：新的在前；不感兴趣的不在里面，除非 includeHidden。 */
  list(query: FeedListQuery, signal?: AbortSignal): Promise<FeedListResponse>;
  /** GET /v2/feed/nav?tz=：第二栏（全部 / 订阅 / 来源，带今天新来的个数）。 */
  nav(timeZone: string, signal?: AbortSignal): Promise<import('./shared.ts').FeedNavResponse>;
  /** GET /v2/video/douyin：抖音收藏的勾选清单。 */
  douyin(query: import('./shared.ts').DouyinListQuery, signal?: AbortSignal):
    Promise<import('./shared.ts').DouyinListResponse>;
  /** POST /v2/video/douyin/sync：排一次同步，Mac 在线就去翻收藏。 */
  douyinSync(input: import('./shared.ts').DouyinSyncRequest): Promise<import('./shared.ts').DouyinSyncResponse>;
  /** POST /v2/video/douyin/process：处理勾选的（处理过的不重复）。 */
  douyinProcess(input: import('./shared.ts').DouyinProcessRequest):
    Promise<import('./shared.ts').DouyinProcessResponse>;
  /** GET /v2/feed/sources：关注点 · 不要的 · 其他站内来源· 最近来源。 */
  sources(signal?: AbortSignal): Promise<FeedSourcesResponse>;
  /** POST /v2/feed/items?tz=：手动加一条链接（标「手动添加」）。 */
  add(input: AddFeedItemRequest, timeZone: string): Promise<FeedItemView>;
  /** POST /v2/feed/items/:id/reaction：赞 / 不感兴趣 / 取消；版本旧了抛 ConflictError。 */
  react(id: string, input: ReactFeedItemRequest): Promise<FeedItemView>;
  /** POST /v2/feed/items/:id/save：收藏 / 取消收藏；版本旧了抛 ConflictError。 */
  save(id: string, input: SaveFeedItemRequest): Promise<FeedItemView>;
  /** POST /v2/feed/sources/:id/level：偏多 / 正常 / 偏少 / 暂停（off）；版本旧了抛 ConflictError。 */
  setSourceLevel(id: string, input: SetSourceLevelRequest): Promise<FeedSourceView>;
  /** GET /v2/feed/sources/reddit/preview：加 Reddit 版块前看最新三条；取不到回原因。 */
  previewReddit(query: import('./shared.ts').RedditPreviewQuery, signal?: AbortSignal):
    Promise<import('./shared.ts').RedditPreviewResponse>;
  /** POST /v2/feed/sources/reddit：加一个 Reddit 版块。 */
  addReddit(input: import('./shared.ts').AddRedditRequest): Promise<FeedSourceView>;
  /** POST /v2/feed/sources/:id/settings：订阅改名字、网址、档位；Reddit 改排序。 */
  updateSource(id: string, input: import('./shared.ts').UpdateFeedSourceRequest): Promise<FeedSourceView>;
  /** POST /v2/feed/sources/:id/refresh：现在刷新这一个来源。 */
  refreshSource(id: string, input: import('./shared.ts').RefreshFeedSourceRequest):
    Promise<import('./shared.ts').RefreshFeedSourceResponse>;
  /** POST /v2/feed/sources/:id/delete：删掉一个订阅 / Reddit 版块。 */
  deleteSource(id: string, input: import('./shared.ts').DeleteFeedSourceRequest): Promise<FeedSourceView>;
}

export interface EventsApi {
  /** GET /v2/events（SSE）。返回取消订阅的函数；signal 中止时也会取消。 */
  subscribe(handlers: EventHandlers, signal?: AbortSignal): () => void;
  /**
   * 下一次订阅能不能从上一次断开的地方接上：真实现带着最后一条事件的 id，服务端补发或自己回 resync，就是 true；
   * 补不了的（假实现，或还没拿到过 id）是 false，EventsHub 重连上之后自己报一次 resync，让各视图重新拉。
   */
  resumable(): boolean;
}

/** M5 甲路：执行节点（设备服务）。领配对码、改上限由本人会话确认，经 SignedApi 发。 */
export interface NodesApi {
  /** GET /v2/nodes：配对过的节点（撤销过的也在）、默认上限、受保护路径。 */
  list(signal?: AbortSignal): Promise<NodeListResponse>;
  /** GET /v2/nodes/actions?nodeId=：最近 50 个设备动作，新的在前；被拒的带哪一层和一句原因。 */
  actions(nodeId: string | null, signal?: AbortSignal): Promise<NodeActionView[]>;
  /** POST /v2/nodes/:id/revoke：带 requestId；撤销两次回答一样。 */
  revoke(id: string, input: RevokeNodeRequest): Promise<NodeView>;
}

/** 沉浸式翻译（2026-11-03）：一批段落的译文、翻译设置、网页翻译的模型档位。 */
export interface TranslateApi {
  translate(body: import('./shared.ts').TranslateRequest, signal?: AbortSignal):
    Promise<import('./shared.ts').TranslateResponse>;
  settings(signal?: AbortSignal): Promise<import('./shared.ts').TranslateSettingsView>;
  saveSettings(body: import('./shared.ts').SetTranslateSettings): Promise<import('./shared.ts').TranslateSettingsView>;
  /** GET /v2/translate/model：翻译用哪个模型（不选就跟默认模型走）。 */
  model(signal?: AbortSignal): Promise<import('./shared.ts').TranslateModelView>;
  /** PUT /v2/translate/model：带 version，旧了 409。 */
  saveModel(body: import('./shared.ts').SetTranslateModelRequest): Promise<import('./shared.ts').TranslateModelView>;
}

export interface SearchApi {
  query(input: import('./shared.ts').SearchQuery, signal?: AbortSignal): Promise<import('./shared.ts').SearchResponse>;
}

export interface PlasticineApi extends M5bApi, ThingsApi, ContactsClientApi {
  networkAttachments: NetworkAttachmentsApi;
  outbound: import('./outbound-client.ts').OutboundApi;
  /** 新内核（2026-11-05）：线和模型连接。 */
  lines: import('./lines-client.ts').LinesApi;
  modelProviders: import('./lines-client.ts').ModelProvidersApi;
  /** 任务栏目（《优化清单》第 3、4、5 条）。 */
  tasks: import('./tasks-client.ts').TasksApi;
  search: SearchApi;
  systems: import('./systems-client.ts').SystemsApi;
  mates: import('./mates-client.ts').MatesApi;
  mateGroups: import('./mates-client.ts').MateGroupsApi;
  translate: TranslateApi;
  attachments: AttachmentsApi;
  links: { preview(url: string, signal?: AbortSignal): Promise<import('./shared.ts').LinkPreview> };
  moneyDrafts: MoneyDraftsApi;
  clientUpdates: ClientUpdatesApi;
  backups: BackupsApi;
  session: SessionApi;
  /** 11-08 首次使用流程：建账号、@账号 + 密码登录、设密码。 */
  account: import('./account-client.ts').AccountApi;
  devices: DevicesApi;
  notes: NotesApi;
  books: import('./books-client.ts').BooksApi;
  /** 第 110 条：书签。 */
  bookmarks: import('./bookmarks-client.ts').BookmarksApi;
  /** 11-08：竖排网页标签的摆放（存在本体里）和网站图标。 */
  webTabs: import('./web-tabs-client.ts').WebTabsApi;
  /** 第 6、7 条：空间与订阅（研究周报、个人回顾）。 */
  spaces: import('./spaces-client.ts').SpacesApi;
  subscriptions: import('./spaces-client.ts').SubscriptionsApi;
  /** 11-08：资料库「最近删除」。 */
  library: import('./spaces-client.ts').LibraryApi;
  asks: AsksApi;
  push: PushApi;
  memory: MemoryApi;
  agreements: AgreementsApi;
  deviceKeys: DeviceKeysApi;
  signed: SignedApi;
  projects: ProjectsApi;
  today: TodayApi;
  feed: FeedApi;
  nodes: NodesApi;
  events: EventsApi;
  /** 任何请求拿到 401 时通知；壳据此回到配对页。返回取消监听的函数。 */
  onUnauthorized(listener: () => void): () => void;
}
