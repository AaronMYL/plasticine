import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PlasticineApi } from './api/client.ts';
import { useApi } from './api/context.tsx';
import { DIRECT_OPEN_EVENT } from './api/direct/direct-channel.ts';
import { EventsHub } from './state/events-hub.ts';
import { usePushDevice } from './api/push-device.ts';
import { MAIN_LINE_ALIAS } from './api/shared.ts';
import { useClientState } from './state/context.tsx';
import { useStore } from './state/use-store.ts';
import { Store } from './state/store.ts';
import { deviceTimeZone } from './state/time-zone.ts';
import { startTimeZone } from './state/live-time-zone.ts';
import { startTimeZoneReport } from './state/report-time-zone.ts';
import { AsksStore } from './views/asks/asks-store.ts';
import { DeviceStore } from './views/device/device-store.ts';
import { DeviceWrites } from './views/device/device-writes.ts';
import { FeedActions } from './views/feed/feed-actions.ts';
import { FeedStore } from './views/feed/feed-store.ts';
import { DouyinStore } from './views/feed/douyin-store.ts';
import { TranscriberStore } from './views/feed/transcriber-store.ts';
import { LinesStore } from './views/lines/line-store.ts';
import { MatesStore } from './views/mates/mates-store.ts';
import { MateActions } from './views/mates/mate-actions.ts';
import { ModelStore } from './views/models/model-store.ts';
import { DailySettingsStore } from './views/settings/daily-settings.ts';
import { PushSwitch } from './views/settings/push-switch.ts';
import { startPresenceReport } from './state/viewing.ts';
import { SignedSender } from './views/signing/signed-sender.ts';
import { MemoryTopicsStore } from './views/memory/topics-store.ts';
import { BookmarkStore } from './views/bookmarks/bookmark-store.ts';
import { ChapterCache } from './views/books/chapter-cache.ts';
import { ToolGroupActions } from './views/tools/tool-group-actions.ts';
import { ContactActions } from './views/contacts/contact-actions.ts';
import { ContactEdits } from './views/contacts/contact-edits.ts';
import { ContactsStore } from './views/contacts/contacts-store.ts';
import { NetworkActions, NetworkStore } from './views/settings/network-store.ts';
import { createToolGroupStores, startToolGroupStores, type ToolGroupStores } from './views/tools/tool-group-stores.ts';

export interface Live {
  timeZone: Store<string>;
  hub: EventsHub;
  lines: LinesStore;
  mates: MatesStore;
  mateActions: MateActions;
  asks: AsksStore;
  models: ModelStore;
  signer: SignedSender;
  push: PushSwitch;
  dailySettings: DailySettingsStore;
  feed: FeedStore;
  feedActions: FeedActions;
  douyin: DouyinStore;
  transcriber: TranscriberStore;
  devices: DeviceStore;
  deviceWrites: DeviceWrites;
  toolGroups: ToolGroupStores;
  toolGroupActions: ToolGroupActions;
  memoryTopics: MemoryTopicsStore;
  bookmarks: BookmarkStore;
  chapters: ChapterCache;
  contacts: ContactsStore;
  contactActions: ContactActions;
  contactEdits: ContactEdits;
  network: NetworkStore;
  networkActions: NetworkActions;
}

const LiveContext = createContext<Live | null>(null);

export function useTimeZone(): string {
  return useStore(useLive().timeZone);
}

type ClientParts = ReturnType<typeof useClientState>;

function createLive(api: PlasticineApi, parts: ClientParts, push: PushSwitch): Live {
  const { actionOps, inlineDrafts, signedOps, feedUi } = parts;
  const timeZone = new Store(deviceTimeZone());
  const hub = new EventsHub(api.events);
  const signer = new SignedSender({ api: api.signed, ops: signedOps });
  const toolGroups = createToolGroupStores(api, hub, () => new Date(), timeZone.get());
  const toolGroupActions = new ToolGroupActions({ api, stores: toolGroups, ops: actionOps, drafts: inlineDrafts });
  const memoryTopics = new MemoryTopicsStore(api, signer);
  const asks = new AsksStore(api, hub);
  signer.onResult((result) => {
    if (result.kind === 'device_action_answer') {
      void asks.reload();
    } else if (result.kind === 'tool_group') {
      toolGroups.toolGroups.apply({ type: 'tool_group.changed', group: result.group });
    } else if (result.kind === 'memory_uncertain') {
      memoryTopics.applyAnswered(result.item);
    }
  });
  const devices = new DeviceStore(api, hub);
  const deviceWrites = new DeviceWrites({ api, devices, ops: actionOps, signedOps, signer,
    drafts: inlineDrafts, ui: parts.deviceUi });
  const feed = new FeedStore(api, hub, feedUi, timeZone.get());
  const mates = new MatesStore(api, hub);
  const contacts = new ContactsStore(api, hub);
  const network = new NetworkStore(api, hub);
  return {
    timeZone,
    hub,
    lines: new LinesStore(api, hub),
    mates,
    mateActions: new MateActions(api, actionOps, mates),
    asks,
    models: new ModelStore(api),
    signer,
    push,
    dailySettings: new DailySettingsStore({ api, ops: actionOps, drafts: inlineDrafts, onSaved: () => undefined }),
    feed,
    feedActions: new FeedActions({ api, store: feed, ops: actionOps, drafts: inlineDrafts, ui: feedUi,
      timeZone: timeZone.get() }),
    douyin: new DouyinStore(api, hub),
    transcriber: new TranscriberStore(api, hub),
    devices,
    deviceWrites,
    toolGroups,
    toolGroupActions,
    memoryTopics,
    bookmarks: new BookmarkStore(api, hub),
    chapters: new ChapterCache(api.books),
    contacts,
    contactActions: new ContactActions({ api, store: contacts, ops: actionOps, drafts: inlineDrafts }),
    contactEdits: new ContactEdits(api, contacts),
    network,
    networkActions: new NetworkActions({ api, store: network, ops: actionOps, drafts: inlineDrafts }),
  };
}

export function LiveProvider({ children }: { children: ReactNode }): ReactNode {
  const api = useApi();
  const device = usePushDevice();
  const parts = useClientState();
  const { notesCache } = parts;
  const [live] = useState<Live>(() => createLive(api, parts, new PushSwitch(api, device)));
  useEffect(() => {
    const stopNotes = notesCache.connect(api.notes, live.hub);
    const stopChapters = live.chapters.connect(live.hub);
    live.lines.start();
    live.mates.start();
    live.asks.start();
    live.bookmarks.start();
    live.feed.start();
    live.devices.start();
    live.contacts.start();
    live.network.start();
    const stopToolGroup = startToolGroupStores(live.toolGroups);
    const stopTimeZone = startTimeZone(live);
    const stopZoneReport = startTimeZoneReport(api.tasks);
    const stopNativePush = live.hub.on((event) => live.push.onEvent(event,
      live.lines.lineOf(MAIN_LINE_ALIAS)?.id ?? null));
    const stopPresence = startPresenceReport((conversation) => api.push.presence(conversation));
    live.hub.start();
    void live.push.start();
    const toDirect = (): void => live.hub.reconnect();
    window.addEventListener(DIRECT_OPEN_EVENT, toDirect);
    return () => {
      stopPresence();
      window.removeEventListener(DIRECT_OPEN_EVENT, toDirect);
      stopNotes();
      stopChapters();
      live.network.stop();
      live.contacts.stop();
      stopTimeZone();
      stopZoneReport();
      stopToolGroup();
      live.push.dispose();
      stopNativePush();
      live.hub.stop();
      live.devices.stop();
      live.feed.stop();
      live.bookmarks.stop();
      live.asks.stop();
      live.lines.stop();
      live.mates.stop();
    };
  }, [live, api, notesCache]);
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export function useOptionalLive(): Live | null {
  return useContext(LiveContext);
}

export function useLive(): Live {
  const live = useContext(LiveContext);
  if (live === null) {
    throw new Error('useLive 必须在 LiveProvider 里面用');
  }
  return live;
}
