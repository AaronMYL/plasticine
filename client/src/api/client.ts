import type { NetworkAttachmentsApi } from './network-attachments-client.ts';
import type { ContactsClientApi } from './contacts-client.ts';
import type { ToolGroupApi } from './tool-groups-client.ts';
import type { ThingsApi } from './things-client.ts';
import type {
  AttachmentView, Backup, BackupDetail, BackupList, ClientVersion,
  CreateBackupRequest, CreateMoneyDraftRequest, EditMoneyDraftRequest, MoneyDraftSummary, MoneyDraftView,
  PurgeOriginalsRequest, PurgeOriginalsResponse, PushStatus, PushTestResponse, RejectMoneyDraftRequest, RestorePreview,
  RestorePreviewRequest, UploadAttachmentMeta,
} from './shared.ts';
export interface BackupsApi {
  list(signal?: AbortSignal): Promise<BackupList>;
  get(id: string, signal?: AbortSignal): Promise<BackupDetail>;
  create(input: CreateBackupRequest): Promise<Backup>;
  preview(id: string, input: RestorePreviewRequest): Promise<RestorePreview>;
  getPreview(id: string, signal?: AbortSignal): Promise<RestorePreview>;
}
export interface ClientUpdatesApi {
  list(signal?: AbortSignal): Promise<ClientVersion>;
}

export interface MoneyDraftsApi {
  create(input: CreateMoneyDraftRequest): Promise<MoneyDraftView>;
  get(id: string, signal?: AbortSignal): Promise<MoneyDraftView>;
  edit(id: string, input: EditMoneyDraftRequest): Promise<MoneyDraftView>;
  reject(id: string, input: RejectMoneyDraftRequest): Promise<MoneyDraftView>;
  summary(signal?: AbortSignal): Promise<MoneyDraftSummary>;
  purgeOriginals(input: PurgeOriginalsRequest): Promise<PurgeOriginalsResponse>;
}

export interface AttachmentsApi {
  text(id: string, signal?: AbortSignal): Promise<import('./shared.ts').AttachmentTextView>;
  lookup(requestId: string, signal?: AbortSignal): Promise<AttachmentView | null>;
  upload(meta: UploadAttachmentMeta, data: Blob, signal?: AbortSignal, onProgress?: (fraction: number) => void):
    Promise<AttachmentView>;
  get(id: string, signal?: AbortSignal): Promise<AttachmentView>;
  contentUrl(id: string): string;
  content(id: string, signal?: AbortSignal): Promise<Blob>;
}
import type { SignedResult, SignedSend, SignedTarget } from './signed-targets.ts';
import type {
  AddFeedItemRequest, AnswerAskRequest, AnswerAskResponse,
  AskAboutRequest, AskAboutResponse, AskListResponse, AskView, CreateNoteRequest, DailySettingsView, DeferAskRequest,
  DeferAskResponse, DeviceView, EventHandlers, FeedItemView, FeedListQuery, FeedListResponse, FeedSourcesResponse,
  FeedSourceView, MemoryEntryDetail, NodeActionView, NodeListResponse, NodeView, NoteMetaView, NoteSearch, NoteView,
  PushKeyResponse, ReactFeedItemRequest, RevokeNodeRequest, SaveFeedItemRequest, SaveNoteRequest, SessionView,
  SetSourceLevelRequest, SubscribePushRequest, SubscribePushResponse, UnsubscribePushRequest, UnsubscribePushResponse,
  UpdateDailySettingsRequest,
} from './types.ts';

export interface SessionApi {
  current(signal?: AbortSignal): Promise<SessionView | null>;
  /** DELETE /v2/session */
  logout(): Promise<void>;
}

export interface DevicesApi {
  list(signal?: AbortSignal): Promise<DeviceView[]>;
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
  assistStream(id: string, input: import('./shared.ts').NoteAssistRequest, onText: (delta: string) => void,
    signal?: AbortSignal): Promise<import('./shared.ts').NoteAssistView>;
  assistOutcome(id: string, input: import('./shared.ts').NoteAssistOutcome): Promise<void>;
  imported(id: string, signal?: AbortSignal): Promise<import('./shared.ts').NoteImportView>;
  list(query: NoteSearch, signal?: AbortSignal): Promise<NoteMetaView[]>;
  /** GET /v2/notes/:id */
  get(id: string, signal?: AbortSignal): Promise<NoteView>;
  /** POST /v2/notes */
  create(input: CreateNoteRequest): Promise<NoteView>;
  save(id: string, input: SaveNoteRequest): Promise<NoteView>;
  remove(id: string, requestId: string): Promise<NoteView>;
  importFiles(input: import('./shared.ts').ImportNotesRequest): Promise<import('./shared.ts').ImportNotesResponse>;
  exportFiles(ids: readonly string[], signal?: AbortSignal): Promise<DownloadedFile>;
}

export interface DownloadedFile {
  blob: Blob;
  name: string;
}

export interface AsksApi {
  feedback(id: string, input: import('./types.ts').AskFeedbackRequest): Promise<AskView>;
  list(signal?: AbortSignal): Promise<AskListResponse>;
  /** GET /v2/asks/:id */
  get(id: string, signal?: AbortSignal): Promise<AskView>;
  answer(id: string, input: AnswerAskRequest): Promise<AnswerAskResponse>;
  defer(id: string, input: DeferAskRequest): Promise<DeferAskResponse>;
  ask(id: string, input: AskAboutRequest): Promise<AskAboutResponse>;
}

export interface PushApi {
  status(signal?: AbortSignal): Promise<PushStatus>;
  key(signal?: AbortSignal): Promise<PushKeyResponse>;
  subscribe(input: SubscribePushRequest): Promise<SubscribePushResponse>;
  unsubscribe(input: UnsubscribePushRequest): Promise<UnsubscribePushResponse>;
  test(): Promise<PushTestResponse>;
  presence(conversation: string | null): Promise<void>;
  kinds(signal?: AbortSignal): Promise<import('./shared.ts').NotifyKinds>;
  saveKinds(kinds: import('./shared.ts').NotifyKinds): Promise<import('./shared.ts').NotifyKinds>;
}

export interface MemoryApi {
  entry(id: string, signal?: AbortSignal): Promise<MemoryEntryDetail>;
}

export interface SignedApi {
  lookup(requestId: string, target: SignedTarget): Promise<SignedResult | null>;
  send(request: SignedSend): Promise<SignedResult>;
}

export interface ProjectsApi {
  list(query: import('./shared.ts').ProjectQuery, signal?: AbortSignal):
    Promise<import('./shared.ts').ProjectListResponse>;
  get(id: string, query: import('./shared.ts').ProjectQuery, signal?: AbortSignal):
    Promise<import('./shared.ts').ProjectDetail>;
  create(input: import('./shared.ts').CreateProjectRequest): Promise<import('./shared.ts').ProjectRowView>;
  edit(id: string, input: import('./shared.ts').EditProjectRequest): Promise<import('./shared.ts').ProjectRowView>;
  setHealth(id: string, input: import('./shared.ts').SetProjectHealthRequest):
    Promise<import('./shared.ts').ProjectRowView>;
  file(id: string, input: import('./shared.ts').FileProjectItemRequest): Promise<import('./shared.ts').ProjectRowView>;
  unfile(id: string, input: import('./shared.ts').UnfileProjectItemRequest):
    Promise<import('./shared.ts').ProjectRowView>;
  addTodo(id: string, input: import('./shared.ts').AddProjectTodoRequest):
    Promise<import('./shared.ts').ProjectTodoResponse>;
  editTodo(id: string, todoId: string, input: import('./shared.ts').EditProjectTodoRequest):
    Promise<import('./shared.ts').ProjectTodoResponse>;
}

export interface TodayApi {
  /** GET /v2/today/settings */
  settings(signal?: AbortSignal): Promise<DailySettingsView>;
  saveSettings(input: UpdateDailySettingsRequest): Promise<DailySettingsView>;
  calendar(query: import('./shared.ts').CalendarTodayQuery, signal?: AbortSignal):
    Promise<import('./shared.ts').CalendarTodayView>;
}

export interface FeedApi {
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
  list(query: FeedListQuery, signal?: AbortSignal): Promise<FeedListResponse>;
  nav(timeZone: string, signal?: AbortSignal): Promise<import('./shared.ts').FeedNavResponse>;
  douyin(query: import('./shared.ts').DouyinListQuery, signal?: AbortSignal):
    Promise<import('./shared.ts').DouyinListResponse>;
  douyinSync(input: import('./shared.ts').DouyinSyncRequest): Promise<import('./shared.ts').DouyinSyncResponse>;
  douyinProcess(input: import('./shared.ts').DouyinProcessRequest):
    Promise<import('./shared.ts').DouyinProcessResponse>;
  transcriber(signal?: AbortSignal): Promise<import('./shared.ts').TranscriberResponse>;
  installTranscriber(input: import('./shared.ts').TranscriberInstallRequest):
    Promise<import('./shared.ts').TranscriberResponse>;
  sources(signal?: AbortSignal): Promise<FeedSourcesResponse>;
  add(input: AddFeedItemRequest, timeZone: string): Promise<FeedItemView>;
  react(id: string, input: ReactFeedItemRequest): Promise<FeedItemView>;
  save(id: string, input: SaveFeedItemRequest): Promise<FeedItemView>;
  setSourceLevel(id: string, input: SetSourceLevelRequest): Promise<FeedSourceView>;
  previewReddit(query: import('./shared.ts').RedditPreviewQuery, signal?: AbortSignal):
    Promise<import('./shared.ts').RedditPreviewResponse>;
  addReddit(input: import('./shared.ts').AddRedditRequest): Promise<FeedSourceView>;
  updateSource(id: string, input: import('./shared.ts').UpdateFeedSourceRequest): Promise<FeedSourceView>;
  refreshSource(id: string, input: import('./shared.ts').RefreshFeedSourceRequest):
    Promise<import('./shared.ts').RefreshFeedSourceResponse>;
  deleteSource(id: string, input: import('./shared.ts').DeleteFeedSourceRequest): Promise<FeedSourceView>;
}

export interface EventsApi {
  subscribe(handlers: EventHandlers, signal?: AbortSignal): () => void;
  resumable(): boolean;
}

export interface NodesApi {
  list(signal?: AbortSignal): Promise<NodeListResponse>;
  actions(nodeId: string | null, signal?: AbortSignal): Promise<NodeActionView[]>;
  revoke(id: string, input: RevokeNodeRequest): Promise<NodeView>;
}

export interface TranslateApi {
  translate(body: import('./shared.ts').TranslateRequest, signal?: AbortSignal):
    Promise<import('./shared.ts').TranslateResponse>;
  settings(signal?: AbortSignal): Promise<import('./shared.ts').TranslateSettingsView>;
  saveSettings(body: import('./shared.ts').SetTranslateSettings): Promise<import('./shared.ts').TranslateSettingsView>;
  model(signal?: AbortSignal): Promise<import('./shared.ts').TranslateModelView>;
  saveModel(body: import('./shared.ts').SetTranslateModelRequest): Promise<import('./shared.ts').TranslateModelView>;
}

export interface ComposeApi {
  predict(target: import('./shared.ts').ComposeTarget, draft: string, onText: (delta: string) => void,
    signal?: AbortSignal): Promise<import('./shared.ts').ComposePredictView>;
  outcome(input: import('./shared.ts').ComposeOutcome): Promise<void>;
}

export interface SearchApi {
  query(input: import('./shared.ts').SearchQuery, signal?: AbortSignal): Promise<import('./shared.ts').SearchResponse>;
}

export interface PlasticineApi extends ToolGroupApi, ThingsApi, ContactsClientApi {
  networkAttachments: NetworkAttachmentsApi;
  soul: import('./soul-client.ts').SoulApi;
  souls: import('./souls-client.ts').SoulsApi;
  outbound: import('./outbound-client.ts').OutboundApi;
  lines: import('./lines-client.ts').LinesApi;
  modelProviders: import('./lines-client.ts').ModelProvidersApi;
  modelUsage: import('./model-usage-client.ts').ModelUsageApi;
  webSearch: import('./web-search-client.ts').WebSearchApi;
  connections: import('./connections-client.ts').ConnectionsApi;
  pushes: import('./connections-client.ts').PushesApi;
  migration: import('./migration-client.ts').MigrationApi;
  tasks: import('./tasks-client.ts').TasksApi;
  search: SearchApi;
  systems: import('./systems-client.ts').SystemsApi;
  mates: import('./mates-client.ts').MatesApi;
  mateGroups: import('./mates-client.ts').MateGroupsApi;
  translate: TranslateApi;
  compose: ComposeApi;
  attachments: AttachmentsApi;
  links: {
    preview(url: string, signal?: AbortSignal): Promise<import('./shared.ts').LinkPreview>;
    image(url: string): string;
  };
  moneyDrafts: MoneyDraftsApi;
  clientUpdates: ClientUpdatesApi;
  backups: BackupsApi;
  session: SessionApi;
  account: import('./account-client.ts').AccountApi;
  devices: DevicesApi;
  notes: NotesApi;
  books: import('./books-client.ts').BooksApi;
  bookmarks: import('./bookmarks-client.ts').BookmarksApi;
  webTabs: import('./web-tabs-client.ts').WebTabsApi;
  spaces: import('./spaces-client.ts').SpacesApi;
  subscriptions: import('./spaces-client.ts').SubscriptionsApi;
  library: import('./spaces-client.ts').LibraryApi;
  asks: AsksApi;
  push: PushApi;
  memory: MemoryApi;
  signed: SignedApi;
  projects: ProjectsApi;
  today: TodayApi;
  feed: FeedApi;
  nodes: NodesApi;
  events: EventsApi;
  onUnauthorized(listener: () => void): () => void;
}
