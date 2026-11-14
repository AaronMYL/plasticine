// 客户端用到的接口类型。服务端的请求、响应和事件一律从 agent/shared/api 导入（plasticine-code 底线第 4 条），
// 这里只 re-export；下面另写的几样只在客户端有：引用片、按 request_id 核实的结果、笔记搜索、
// 视图订阅的实时事件（由服务端的 SSE 事件映射而来，见 http/event-mapper.ts）和连接状态。

import type {
  BrowserViewDto,
  InboxRowView,
  InboxUnread,
  MoneyEntryView,
  ToolGroupView,
} from './shared.ts';
import type {
  AgreementView,
  AskView,
  NodeActionView,
  NodeView,
  FeedItemView,
  MemoryEntryView,
  NoteMetaView,
  BookQuoteReference,
  NoteQuoteReference,
  SpaceQuoteReference,
} from './shared.ts';

// M5 甲路：执行节点、设备动作。
export type {
  DeviceActionClass,
  DeviceActionParams,
  DeviceClassMode,
  DeviceLimits,
  EveryStreamEvent,
  IssueNodePairingCodeRequest,
  NodeActionListResponse,
  NodeActionView,
  NodeListResponse,
  NodePairingCodeResponse,
  NodeView,
  RevokeNodeRequest,
  SetNodeLimitsRequest,
} from './shared.ts';

// M4：今日设置、信息流。
export type {
  AddFeedItemRequest,
  BriefItemView,
  DailySettingsView,
  FeedItemView,
  FeedListQuery,
  FeedListResponse,
  FeedSourceView,
  FeedSourcesResponse,
  ReactFeedItemRequest,
  ReadReturnBriefRequest,
  ReturnBriefView,
  ReturnSentenceView,
  SaveFeedItemRequest,
  SeeBriefItemRequest,
  SetSourceLevelRequest,
  SetSourceQueryRequest,
  TodayNumbers,
  UpdateDailySettingsRequest,
} from './shared.ts';

// M3：记忆、约定、设备钥匙。
export type {
  AgreementDetail,
  AgreementListQuery,
  AgreementListResponse,
  AgreementView,
  ChangeRecordView,
  ConfirmAgreementRequest,
  DeviceKeyView,
  MemoryBoardQuery,
  MemoryBoardResponse,
  MemoryColumn,
  MemoryEntriesQuery,
  MemoryEntryDetail,
  MemoryEntryView,
  PublicKeyJwk,
  SourceView,
} from './shared.ts';

export type {
  AnswerAskRequest,
  AnswerAskResponse,
  AskAboutRequest,
  AskAboutResponse,
  AskListResponse,
  AskView,
  AskFeedbackRequest,
  CreateNoteRequest,
  DeferAskRequest,
  DeferAskResponse,
  DeviceView,
  NoteConflict,
  NoteMetaView,
  NoteView,
  PushKeyResponse,
  PushPayload,
  ReplyLayers,
  SaveNoteRequest,
  ServerEvent,
  SessionView,
  SubscribePushRequest,
  SubscribePushResponse,
  UnsubscribePushRequest,
  UnsubscribePushResponse,
} from './shared.ts';

// ---------- 只在客户端有的 ----------

/**
 * 引用片：新版笔记携带准确版本和范围，由服务端解析成正文快照；书里划的一段带书、章和位置。
 * 旧引用仍按原有正文格式发送。
 */
export interface Quote {
  id: string;
  /** 从哪里来：笔记 / 书 / 消息 / 页面对象。 */
  kind: 'note' | 'book' | 'space' | 'message' | 'object';
  /** 来源对象的 id（笔记 id、消息 id）。 */
  sourceId: string;
  /** 界面上显示的来源名，例如笔记标题。 */
  label: string;
  text: string;
  noteReference?: NoteQuoteReference;
  /** 书里划的一段：服务端按位置从章节原文重取一遍，对得上才发；聊天里的引用片靠它「回到原文」。 */
  bookReference?: BookQuoteReference;
  spaceReference?: SpaceQuoteReference;
}

/** 气泡上方显示的一段引用：从正文拆出来的只剩这几样。 */
export type QuoteChip = Pick<Quote, 'id' | 'label' | 'text' | 'noteReference' | 'bookReference' | 'spaceReference'>
  & Partial<Pick<Quote, 'kind'>>;

/** 服务端按正文搜索并分页；文件夹与回收站共用此查询。 */
export type NoteSearch = Omit<import('./shared.ts').NoteListQuery, 'limit' | 'offset'>;

/**
 * 视图订阅的实时事件（由服务端的 SSE 事件映射而来）。ask.* 是要你定的卡（服务端 ask_created / ask_answered /
 * ask_updated 原样带过来）；memory / agreement 整行带过来，按 version 换；note.updated / note.deleted 是本机写笔记后
 * 自己发的；project.invalidated 是项目写入提交后的跨设备失效；line 是新内核的线事件；
 * resync 表示事件流补不上了（服务端回 ready{resync:true}，或收到认不出的事件），
 * 各视图要重新拉一遍。2026-11-05 旧对话、任务、关切、十件事、判断、≠、自迭代、事、专注、提醒、成果的事件删了。
 */
export type LiveEvent =
  | { type: 'note.invalidated'; noteId: string }
  | { type: 'project.invalidated'; projectId: string }
  | { type: 'book.changed'; bookId: string; part: BookChangedPart }
  | { type: 'attachment.changed'; attachment: import('./shared.ts').AttachmentView }
  | { type: 'money-draft.changed'; draft: import('./shared.ts').MoneyDraftView }
  | { type: 'client.versionChanged' }
  | { type: 'backups.changed' }
  /** 任务栏目（定时、建议）变了：第二栏和主区重读。 */
  | { type: 'tasks.changed' }
  /** 第 15 条：日历和提醒的缓存刚从 Mac 同步过，首页「今天」重读。 */
  | { type: 'calendar.changed' }
  /** 第 9 条：抖音收藏 / 视频解析有一条变了，勾选清单重读。 */
  | { type: 'video.changed' }
  | { type: 'space.changed'; spaceId: string }
  /** 11-08：竖排标签的摆放在别的设备上改了（version 是改完的版本）。 */
  | { type: 'webTabs.changed'; version: number }
  /** 第 8 批第 1 条：书签在别处改了（各设备同一份），重读列表。 */
  | { type: 'bookmarks.changed' }
  | { type: 'note.updated'; note: NoteMetaView }
  | { type: 'note.deleted'; noteId: string }
  | ({ type: 'ask.created'; ask: AskView; current: boolean } & BoardEventState)
  | ({ type: 'ask.answered'; ask: AskView } & BoardEventState)
  | ({ type: 'ask.updated'; ask: AskView } & BoardEventState)
  | { type: 'memory.changed'; entry: MemoryEntryView }
  | { type: 'agreement.changed'; agreement: AgreementView }
  | { type: 'feed.changed'; item: FeedItemView }
  | { type: 'node.changed'; node: NodeView }
  | { type: 'node_action.recorded'; action: NodeActionView }
  | M5bLiveEvent
  | ContactsLiveEvent
  /** 新内核的线（2026-11-05）：服务端 line_* 事件原样带过来。 */
  | { type: 'line'; event: import('./shared.ts').LineStreamEvent }
  /** 第13批：一条新消息该通知（桌面客户端自己弹；url 是站内地址，conversation 是哪段对话）。 */
  | { type: 'notify'; title: string; body: string; url: string; tag: string; conversation: string }
  // 第13批：通知按类型的开关在别的设备上改了。
  | { type: 'notify.kinds'; kinds: import('./shared.ts').NotifyKinds }
  | { type: 'resync' };

/**
 * 第 113 条：联系人。contacts_changed 只说列表变了（带等你数和未读数，侧栏和底栏的点跟着走，列表再拉一份）；
 * contact_item 是某个联系人的聊天里多了或变了一项（一句话、一张任务卡、一段折起来的 AI↔AI），按身份换。
 */
export type ContactsLiveEvent =
  | { type: 'contacts.changed'; waiting: number; unread: number }
  | { type: 'contact.item'; contactId: string; item: import('./shared.ts').ContactThreadItem };

/** M5 乙路：服务端的 money_changed 等原样带过来（整行，按 id / version 换）。 */
export type M5bLiveEvent =
  | { type: 'money.changed'; entry: MoneyEntryView }
  | { type: 'inbox.changed'; message: InboxRowView; unread: InboxUnread }
  | { type: 'tool_group.changed'; group: ToolGroupView }
  | { type: 'browser.changed'; browser: BrowserViewDto };

/** 服务端 book_changed 的 part：书的元数据 / 标注 / 进度 / 大纲重点，界面按它只重拉那一块。 */
export type BookChangedPart = Extract<import('./shared.ts').ServerEvent, { type: 'book_changed' }>['part'];

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface BoardEventState {
  currentId?: string | null;
  waitingOnYouCount?: number;
}

export interface EventHandlers {
  onEvent: (event: LiveEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
}
