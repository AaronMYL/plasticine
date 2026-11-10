// M5 乙路的接口函数签名：记账、专注、提醒和日历、遥测、站内信、工具组、文件页、成果、浏览器。http/ 的真实现和 fake/ 的
// 内存实现都满足它；PlasticineApi 从这里继承（client.ts）。请求和响应的形状都是 agent/shared/api 里的。
// 带 requestId 的写操作回执不确定时抛 kind = uncertain 的 ApiError（约定 2）；带 version 的过时了抛 ConflictError。

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
  /** GET /v2/money?month=&tz=：这个月的账本、分类、账户和资产。 */
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
  /** GET /v2/tool-groups；开关一组由本人会话确认，经 SignedApi（target kind = tool_group）发。 */
  list(signal?: AbortSignal): Promise<ToolGroupListResponse>;
}

export interface FilesApi {
  readText(path: string, signal?: AbortSignal): Promise<import('./shared.ts').FileTextView>;
  writeText(input: import('./shared.ts').WriteFileTextRequest): Promise<import('./shared.ts').FileTextView>;
  list(path: string, signal?: AbortSignal): Promise<FileListResponse>;
  /** 下载链接（同源、cookie 会话）：浏览器自己下载，不经 fetch。 */
  downloadUrl(path: string): string;
  upload(input: UploadFileRequest): Promise<FileEntryView>;
  createFolder(input: CreateFolderRequest): Promise<FileEntryView>;
  move(input: MoveFileRequest): Promise<FileEntryView>;
  trash(input: TrashFileRequest): Promise<TrashEntryView>;
  trashed(signal?: AbortSignal): Promise<TrashListResponse>;
  restore(input: RestoreFileRequest): Promise<FileEntryView>;
}

export interface BrowserApi {
  extract(input: WebExtractInput, signal?: AbortSignal): Promise<WebExtractView>;
  archive(input: WebArchiveRequest, signal?: AbortSignal): Promise<WebArchiveView>;
  stream(query: BrowserStreamQuery, event: (event: BrowserStreamEvent) => void, error: () => void): () => void;
  ack(input: BrowserAck): Promise<void>;
  tab(input: BrowserTabRequest): Promise<BrowserViewDto>;
  get(signal?: AbortSignal): Promise<BrowserViewDto>;
  /** 一帧画面的链接；at 让浏览器每次都重新要（画面会变）。 */
  frameUrl(at: number): string;
  open(input: OpenBrowserRequest): Promise<BrowserViewDto>;
  /** 页面上的动作：说不清做没做是 409 result_unknown（kind = failed，code 照服务端），用 settle 说做没做成。 */
  act(input: BrowserActionRequest): Promise<BrowserActionResponse>;
  settle(requestId: string, input: SettleActionRequest): Promise<SettleActionResponse>;
}

export interface NoteVersionsApi {
  versions(noteId: string, signal?: AbortSignal): Promise<NoteVersionListResponse>;
  version(noteId: string, version: number, signal?: AbortSignal): Promise<NoteVersionText>;
}

export interface M5bApi {
  skills: import('./capabilities-client.ts').SkillsApi;
  money: MoneyApi;
  inbox: InboxApi;
  toolGroups: ToolGroupsApi;
  files: FilesApi;
  browser: BrowserApi;
  noteVersions: NoteVersionsApi;
}
