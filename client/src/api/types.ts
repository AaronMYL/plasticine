import type {
  AskView, BookQuoteReference, BrowserViewDto, FeedItemView, InboxRowView, InboxUnread, MemoryEntryView,
  MoneyEntryView, NodeActionView, NodeView, NoteMetaView, NoteQuoteReference, SpaceQuoteReference, ToolGroupView,
} from './shared.ts';

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

export type {
  ChangeRecordView,
  MemoryBoardQuery,
  MemoryBoardResponse,
  MemoryColumn,
  MemoryEntriesQuery,
  MemoryEntryDetail,
  MemoryEntryView,
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

export interface Quote {
  id: string;
  kind: 'note' | 'book' | 'space' | 'message' | 'object';
  sourceId: string;
  label: string;
  text: string;
  noteReference?: NoteQuoteReference;
  bookReference?: BookQuoteReference;
  spaceReference?: SpaceQuoteReference;
}

export type QuoteChip = Pick<Quote, 'id' | 'label' | 'text' | 'noteReference' | 'bookReference' | 'spaceReference'>
  & Partial<Pick<Quote, 'kind'>>;

export type NoteSearch = Omit<import('./shared.ts').NoteListQuery, 'limit' | 'offset'>;

export type LiveEvent =
  | { type: 'note.invalidated'; noteId: string }
  | { type: 'project.invalidated'; projectId: string }
  | { type: 'book.changed'; bookId: string; part: BookChangedPart }
  | { type: 'attachment.changed'; attachment: import('./shared.ts').AttachmentView }
  | { type: 'money-draft.changed'; draft: import('./shared.ts').MoneyDraftView }
  | { type: 'client.versionChanged' }
  | { type: 'backups.changed' }
  | { type: 'tasks.changed' }
  | { type: 'pushes.changed' }
  | { type: 'connections.changed' }
  | { type: 'calendar.changed' }
  | { type: 'video.changed' }
  | { type: 'transcriber.changed'; status: import('./shared.ts').TranscriberStatus }
  | { type: 'space.changed'; spaceId: string }
  | { type: 'webTabs.changed'; version: number }
  | { type: 'bookmarks.changed' }
  | { type: 'note.updated'; note: NoteMetaView }
  | { type: 'note.deleted'; noteId: string }
  | ({ type: 'ask.created'; ask: AskView; current: boolean } & BoardEventState)
  | ({ type: 'ask.answered'; ask: AskView } & BoardEventState)
  | ({ type: 'ask.updated'; ask: AskView } & BoardEventState)
  | { type: 'memory.changed'; entry: MemoryEntryView }
  | { type: 'feed.changed'; item: FeedItemView }
  | { type: 'node.changed'; node: NodeView }
  | { type: 'node_action.recorded'; action: NodeActionView }
  | ToolGroupLiveEvent
  | ContactsLiveEvent
  | { type: 'line'; event: import('./shared.ts').LineStreamEvent }
  | { type: 'notify'; title: string; body: string; url: string; tag: string; conversation: string }
  | { type: 'notify.kinds'; kinds: import('./shared.ts').NotifyKinds }
  | { type: 'resync' };

export type ContactsLiveEvent =
  | { type: 'contacts.changed'; waiting: number; unread: number }
  | { type: 'contact.item'; contactId: string; item: import('./shared.ts').ContactThreadItem };

export type ToolGroupLiveEvent =
  | { type: 'money.changed'; entry: MoneyEntryView }
  | { type: 'inbox.changed'; message: InboxRowView; unread: InboxUnread }
  | { type: 'tool_group.changed'; group: ToolGroupView }
  | { type: 'browser.changed'; browser: BrowserViewDto };

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
