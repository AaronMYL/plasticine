import type {
  AddMoneyAccountRequest,
  WebExtractInput, WebExtractView, WebArchiveRequest, WebArchiveView,
  BrowserActionRequest,
  BrowserActionResponse,
  BrowserViewDto,
  BrowserStreamQuery,
  BrowserStreamEvent,
  BrowserAck,
  BrowserTabRequest,
  CreateFolderRequest,
  EditMoneyAccountRequest,
  EditMoneyRequest,
  FileEntryView,
  FileListResponse,
  InboxListQuery,
  InboxListResponse,
  InboxMessageView,
  InboxReplyView,
  InboxRowResponse,
  MoneyAccountView,
  MoneyEntryView,
  MoneyQuery,
  MoneyResponse,
  MoneyStatsQuery,
  MoneyStatsResponse,
  MoveFileRequest,
  NoteVersionListResponse,
  NoteVersionText,
  OpenBrowserRequest,
  ReadAllInboxRequest,
  ReadAllInboxResponse,
  RecordMoneyRequest,
  RemoveMoneyRequest,
  ReplyInboxRequest,
  RestoreFileRequest,
  SetInboxFlagsRequest,
  SettleActionRequest,
  SettleActionResponse,
  SettleInboxReplyRequest,
  ToolGroupListResponse,
  TrashEntryView,
  TrashFileRequest,
  TrashListResponse,
  UploadFileRequest,
} from './shared.ts';

export interface MoneyApi {
  month(query: MoneyQuery, signal?: AbortSignal): Promise<MoneyResponse>;
  /** GET /v2/money/stats */
  stats(query: MoneyStatsQuery, signal?: AbortSignal): Promise<MoneyStatsResponse>;
  record(input: RecordMoneyRequest): Promise<MoneyEntryView>;
  edit(id: string, input: EditMoneyRequest): Promise<MoneyEntryView>;
  remove(id: string, input: RemoveMoneyRequest): Promise<MoneyEntryView>;
  addAccount(input: AddMoneyAccountRequest): Promise<MoneyAccountView>;
  editAccount(id: string, input: EditMoneyAccountRequest): Promise<MoneyAccountView>;
}

export interface InboxApi {
  sync(input: import('./shared.ts').SyncInboxRequest, signal?: AbortSignal):
    Promise<import('./shared.ts').SyncInboxResponse>;
  feedback(input: import('./shared.ts').InboxFeedbackRequest): Promise<InboxRowResponse>;
  list(query: InboxListQuery, signal?: AbortSignal): Promise<InboxListResponse>;
  get(id: string, signal?: AbortSignal): Promise<InboxMessageView>;
  setFlags(id: string, input: SetInboxFlagsRequest): Promise<InboxRowResponse>;
  readAll(input: ReadAllInboxRequest): Promise<ReadAllInboxResponse>;
  reply(id: string, input: ReplyInboxRequest): Promise<InboxReplyView>;
  settleReply(replyId: string, input: SettleInboxReplyRequest): Promise<InboxReplyView>;
}

export interface ToolGroupsApi {
  list(signal?: AbortSignal): Promise<ToolGroupListResponse>;
}

export interface FilesApi {
  readText(path: string, signal?: AbortSignal): Promise<import('./shared.ts').FileTextView>;
  writeText(input: import('./shared.ts').WriteFileTextRequest): Promise<import('./shared.ts').FileTextView>;
  list(path: string, signal?: AbortSignal): Promise<FileListResponse>;
  downloadUrl(path: string): string;
  upload(input: UploadFileRequest): Promise<FileEntryView>;
  createFolder(input: CreateFolderRequest): Promise<FileEntryView>;
  move(input: MoveFileRequest): Promise<FileEntryView>;
  trash(input: TrashFileRequest): Promise<TrashEntryView>;
  trashed(signal?: AbortSignal): Promise<TrashListResponse>;
  restore(input: RestoreFileRequest): Promise<FileEntryView>;
  exportTable(input: import('./shared.ts').ExportTableRequest): Promise<FileEntryView>;
}

export interface BrowserApi {
  extract(input: WebExtractInput, signal?: AbortSignal): Promise<WebExtractView>;
  archive(input: WebArchiveRequest, signal?: AbortSignal): Promise<WebArchiveView>;
  stream(query: BrowserStreamQuery, event: (event: BrowserStreamEvent) => void, error: () => void): () => void;
  ack(input: BrowserAck): Promise<void>;
  tab(input: BrowserTabRequest): Promise<BrowserViewDto>;
  get(signal?: AbortSignal): Promise<BrowserViewDto>;
  frameUrl(at: number): string;
  open(input: OpenBrowserRequest): Promise<BrowserViewDto>;
  act(input: BrowserActionRequest): Promise<BrowserActionResponse>;
  settle(requestId: string, input: SettleActionRequest): Promise<SettleActionResponse>;
}

export interface NoteVersionsApi {
  versions(noteId: string, signal?: AbortSignal): Promise<NoteVersionListResponse>;
  version(noteId: string, version: number, signal?: AbortSignal): Promise<NoteVersionText>;
}

export interface ToolGroupApi {
  skills: import('./capabilities-client.ts').SkillsApi;
  money: MoneyApi;
  inbox: InboxApi;
  toolGroups: ToolGroupsApi;
  files: FilesApi;
  browser: BrowserApi;
  noteVersions: NoteVersionsApi;
}
