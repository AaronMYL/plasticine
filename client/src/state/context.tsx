// 客户端状态的入口：一次创建，整个应用共用；登录失效重新配对时也不丢（草稿、待发记录、笔记操作、任务 / 卡操作、
// 编辑草稿和本人确认操作的标识都在会话之外）。

import { createContext, useContext, type ReactNode } from 'react';
import { ActionOps } from './action-ops.ts';
import { AttachmentDrafts } from './attachment-drafts.ts';
import { ConcernsUi } from './concerns-ui.ts';
import { ConversationUi } from './conversation-ui.ts';
import { ConversationRegistry } from './conversation-registry.ts';
import { DockTargets } from './conversation-targets.ts';
import { DeviceUi } from './device-ui.ts';
import { EditDrafts } from './edit-drafts.ts';
import { FeedUi } from './feed-ui.ts';
import { InlineDrafts } from './inline-drafts.ts';
import { NoteDrafts } from './note-drafts.ts';
import { NotesUi } from './notes-ui.ts';
import { NotesCache } from './notes-cache.ts';
import { NoteOps } from './note-ops.ts';
import { Outbox, type KeyValueStorage } from './outbox.ts';
import { ShellPrefs } from './shell-prefs.ts';
import { SignedOps } from './signed-ops.ts';
import { TasksUi } from './tasks-ui.ts';
import { ViewScroll } from './view-scroll.ts';
import { WebTabsStore } from './web-tabs.ts';
import { MessagesUi } from './messages-ui.ts';
import { WidgetAnswersStore } from './widget-answers.ts';
import { PageSteps } from './page-steps.ts';

export interface ClientState {
  attachments: AttachmentDrafts;
  conversationUi: ConversationUi;
  conversations: ConversationRegistry;
  dockTargets: DockTargets;
  outbox: Outbox;
  noteDrafts: NoteDrafts;
  noteOps: NoteOps;
  notesUi: NotesUi;
  notesCache: NotesCache;
  actionOps: ActionOps;
  inlineDrafts: InlineDrafts;
  editDrafts: EditDrafts;
  signedOps: SignedOps;
  tasksUi: TasksUi;
  concernsUi: ConcernsUi;
  feedUi: FeedUi;
  deviceUi: DeviceUi;
  viewScroll: ViewScroll;
  shellPrefs: ShellPrefs;
  /** 竖排标签（《优化清单》第 2 条：只有网页是标签）：存在 localStorage。 */
  webTabs: WebTabsStore;
  /** 消息第二栏的筛选（全部 / 人 / 群 / 邮件）：第二栏和手机列表共用。 */
  messagesUi: MessagesUi;
  /** 消息里互动部件的作答（设计稿 2026-11-03）：服务端作答接口上线前记在本机。 */
  widgetAnswers: WidgetAnswersStore;
  /** 第 3 批：Plasticine 在网页标签里做过的步（Mac 报来的），对话框里列出来。 */
  pageSteps: PageSteps;
  /** 2026-11-05：这台设备上 App 在不在前台，首页「离开时」那一行按它算（存 localStorage）。 */
}

export interface ClientStateOptions {
  /** 待发记录、标识和草稿另存一份的地方（浏览器里是 sessionStorage）；不给就只在内存里。 */
  storage?: KeyValueStorage | null;
  /** 已确认的普通笔记使用有界持久缓存；浏览器入口使用 localStorage，草稿仍与它分开。 */
  noteCacheStorage?: KeyValueStorage | null;
  /** 「现在」（网页标签的时间按它算）；测试给固定的。 */
  now?: () => Date;
}

export function createClientState(options: ClientStateOptions = {}): ClientState {
  const storage = options.storage ?? null;
  const actionOps = new ActionOps(storage);
  const attachments = new AttachmentDrafts(storage, actionOps);
  const conversationUi = new ConversationUi(storage);
  return {
    attachments,
    conversationUi,
    conversations: new ConversationRegistry(conversationUi, attachments, actionOps),
    dockTargets: new DockTargets(options.noteCacheStorage === undefined ? storage : options.noteCacheStorage),
    outbox: new Outbox(storage),
    noteDrafts: new NoteDrafts(),
    noteOps: new NoteOps(storage),
    notesUi: new NotesUi(options.noteCacheStorage === undefined ? storage : options.noteCacheStorage, storage),
    notesCache: new NotesCache(options.noteCacheStorage === undefined ? storage : options.noteCacheStorage),
    actionOps,
    inlineDrafts: new InlineDrafts(storage),
    editDrafts: new EditDrafts(storage),
    signedOps: new SignedOps(storage),
    tasksUi: new TasksUi(),
    concernsUi: new ConcernsUi(),
    feedUi: new FeedUi(),
    deviceUi: new DeviceUi(),
    viewScroll: new ViewScroll(storage),
    shellPrefs: new ShellPrefs(options.noteCacheStorage === undefined ? storage : options.noteCacheStorage),
    webTabs: new WebTabsStore(options.noteCacheStorage === undefined ? storage : options.noteCacheStorage,
      options.now),
    messagesUi: new MessagesUi(),
    widgetAnswers: new WidgetAnswersStore(),
    pageSteps: new PageSteps(),
  };
}

const ClientStateContext = createContext<ClientState | null>(null);

export function ClientStateProvider({ state, children }: { state: ClientState; children: ReactNode }): ReactNode {
  return <ClientStateContext.Provider value={state}>{children}</ClientStateContext.Provider>;
}

export function useClientState(): ClientState {
  const state = useContext(ClientStateContext);
  if (state === null) {
    throw new Error('useClientState 必须在 ClientStateProvider 里面用');
  }
  return state;
}

/** 不一定在 ClientStateProvider 里的小部件（网站图标）用：没有时是 null。 */
export function useClientStateOrNull(): ClientState | null {
  return useContext(ClientStateContext);
}
