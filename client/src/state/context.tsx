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
  webTabs: WebTabsStore;
  messagesUi: MessagesUi;
  widgetAnswers: WidgetAnswersStore;
  pageSteps: PageSteps;
}

export interface ClientStateOptions {
  storage?: KeyValueStorage | null;
  noteCacheStorage?: KeyValueStorage | null;
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
    conversations: new ConversationRegistry(conversationUi, attachments, actionOps, storage),
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

export function useClientStateOrNull(): ClientState | null {
  return useContext(ClientStateContext);
}
