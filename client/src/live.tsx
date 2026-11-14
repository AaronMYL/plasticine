// 登录之后才有的那一层：一条 SSE（EventsHub）、线（新内核：主对话和后台线）、要你定卡、模型连接、记忆页的 store、
// 本人确认请求的发送、系统通知的开关、信息流和日常设置、设置 · 系统的设备与运行情况。登录失效时整层卸掉，重新配对后重建；
// 草稿、写操作的标识、就地草稿和编辑草稿在 state/ 里，不在这一层，所以卸掉重建时没了结的那几条还在；系统通知
// 开着的，重建时把订阅再交给服务端一次。2026-11-05 Harness 重做：旧的对话、任务、关切、判断、首页汇报、事、启用都拿掉了。

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Value } from 'typebox/value';
import type { PlasticineApi } from './api/client.ts';
import { useApi } from './api/context.tsx';
import { DIRECT_OPEN_EVENT } from './api/direct/direct-channel.ts';
import { EventsHub } from './api/events-hub.ts';
import { usePushDevice } from './api/push-device.ts';
import { AgreementViewSchema, MAIN_LINE_ALIAS } from './api/shared.ts';
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
import { LinesStore } from './views/lines/line-store.ts';
import { MatesStore } from './views/mates/mates-store.ts';
import { MateActions } from './views/mates/mate-actions.ts';
import { AgreementStore } from './views/memory/agreement-store.ts';
import { CognitionActions, settleCognitionDraft } from './views/memory/cognition-actions.ts';
import { ModelStore } from './views/models/model-store.ts';
import { DailySettingsStore } from './views/settings/daily-settings.ts';
import { PushSwitch } from './views/settings/push-switch.ts';
import { startPresenceReport } from './state/viewing.ts';
import { SignedSender } from './views/signing/signed-sender.ts';
import { MemoryTopicsStore } from './views/memory/topics-store.ts';
import { BookmarkStore } from './views/bookmarks/bookmark-store.ts';
import { ChapterCache } from './views/books/chapter-cache.ts';
import { M5bActions } from './views/m5b/m5b-actions.ts';
import { ContactActions } from './views/contacts/contact-actions.ts';
import { ContactEdits } from './views/contacts/contact-edits.ts';
import { ContactsStore } from './views/contacts/contacts-store.ts';
import { NetworkActions, NetworkStore } from './views/settings/network-store.ts';
import { createM5bStores, startM5bStores, type M5bStores } from './views/m5b/m5b-stores.ts';

export interface Live {
  timeZone: Store<string>;
  hub: EventsHub;
  /** 新内核（2026-11-05）：主对话和后台线；要你定卡；模型连接。 */
  lines: LinesStore;
  mates: MatesStore;
  mateActions: MateActions;
  asks: AsksStore;
  models: ModelStore;
  /** 记忆页「约定」那一段（2026-11-03 起旧的原话 / 解释三栏去掉）。 */
  agreements: AgreementStore;
  cognitionActions: CognitionActions;
  signer: SignedSender;
  push: PushSwitch;
  dailySettings: DailySettingsStore;
  feed: FeedStore;
  feedActions: FeedActions;
  /** 第 6 批第 9 条：抖音收藏的勾选清单。 */
  douyin: DouyinStore;
  /** 设置 · 系统：设备、运行情况、备份、版本。 */
  devices: DeviceStore;
  deviceWrites: DeviceWrites;
  /** M5 乙路：记账、收件箱、工具组、文件、浏览器的数据和写操作。 */
  m5b: M5bStores;
  m5bActions: M5bActions;
  memoryTopics: MemoryTopicsStore;
  /** 第 111 条：书签和项目名单（名字、颜色）。 */
  bookmarks: BookmarkStore;
  chapters: ChapterCache;
  /** 第 113 条：联系人（列表、聊天、资料）和它们的写操作；设置里的网络账号、对外可见。 */
  contacts: ContactsStore;
  contactActions: ContactActions;
  /** 第 12 批：表情、备注、绑人物页、删除和恢复。 */
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
  const { actionOps, inlineDrafts, signedOps, editDrafts, feedUi } = parts;
  const timeZone = new Store(deviceTimeZone());
  const hub = new EventsHub(api.events);
  const signer = new SignedSender({ api: api.signed, ops: signedOps });
  const agreements = new AgreementStore(api, hub, signer);
  const cognitionActions = new CognitionActions({ agreements });
  const m5b = createM5bStores(api, hub, () => new Date(), timeZone.get());
  const m5bActions = new M5bActions({ api, stores: m5b, ops: actionOps, drafts: inlineDrafts });
  const memoryTopics = new MemoryTopicsStore(api, signer);
  const asks = new AsksStore(api, hub);
  signer.onResult((result, op) => {
    if (result.kind === 'device_action_answer') {
      void asks.reload();
    } else if (result.kind === 'agreement') {
      agreements.applyAgreement(result.agreement);
      if (op.target.kind === 'agreement_edit') {
        const body: Record<string, unknown> = JSON.parse(op.bodyText);
        settleCognitionDraft(editDrafts, op.key, body, result.agreement.version);
      }
    } else if (result.kind === 'tool_group') {
      m5b.toolGroups.apply({ type: 'tool_group.changed', group: result.group });
    } else if (result.kind === 'memory_uncertain') {
      memoryTopics.applyAnswered(result.item);
    }
  });
  signer.onConflict((op, current) => {
    if (op.target.kind === 'agreement_edit') {
      cognitionActions.conflict(op.key, current);
    } else if (op.target.kind === 'agreement_confirm' && Value.Check(AgreementViewSchema, current)) {
      // 约定没有草稿：换上现在那一版，再点就是按新版确认。
      agreements.applyAgreement(current);
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
    agreements,
    cognitionActions,
    signer,
    push,
    dailySettings: new DailySettingsStore({ api, ops: actionOps, drafts: inlineDrafts, onSaved: () => undefined }),
    feed,
    feedActions: new FeedActions({ api, store: feed, ops: actionOps, drafts: inlineDrafts, ui: feedUi,
      timeZone: timeZone.get() }),
    douyin: new DouyinStore(api, hub),
    devices,
    deviceWrites,
    m5b,
    m5bActions,
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
    live.agreements.start();
    live.bookmarks.start();
    live.feed.start();
    live.devices.start();
    live.contacts.start();
    live.network.start();
    const stopM5b = startM5bStores(live.m5b);
    const stopTimeZone = startTimeZone(live);
    // 定时按这台设备现在的时区算：打开时报一次，切回来变了再报。
    const stopZoneReport = startTimeZoneReport(api.tasks);
    const stopNativePush = live.hub.on((event) => live.push.onEvent(event,
      live.lines.lineOf(MAIN_LINE_ALIAS)?.id ?? null));
    // 第13批：页面在前台时报正开着哪段对话，服务端不推他正看着的那段。
    const stopPresence = startPresenceReport((conversation) => api.push.presence(conversation));
    live.hub.start();
    void live.push.start();
    // 直连通了（api/direct/direct-link.tsx）：事件流断开重连一次，下一条就从直连走。
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
      stopM5b();
      // 进行中的通知开关操作作废：重新配对后旧实例的请求回来，不再替这台设备订阅、登记（review-followups 912f540）。
      live.push.dispose();
      stopNativePush();
      live.hub.stop();
      live.devices.stop();
      live.feed.stop();
      live.bookmarks.stop();
      live.agreements.stop();
      live.asks.stop();
      live.lines.stop();
      live.mates.stop();
    };
  }, [live, api, notesCache]);
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

/** 不在 LiveProvider 里（单独画的小部件、测试）时是 null。 */
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
