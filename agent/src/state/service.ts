// Opens plasticine.sqlite, brings its schema up to date and hands out one store per table. The database handle
// stays inside: other modules get these stores and `transaction`, never the connection (plasticine-code 边界).
// 2026-11-05 Harness 重做：任务、对话轮、事、自迭代、关切、判断、采访这些表由迁移 0059 删掉，它们的 store 一起删了。

import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createAgreementStore } from './agreements.ts';
import { createApiRequestLog } from './api-requests.ts';
import { createAskStore } from './asks.ts';
import { createFeedTranslationStore } from './feed-translations.ts';
import { createVideoStores } from './video-works.ts';
import { createNetworkAttachmentStore } from './network-attachments.ts';
import { createAttachmentStore } from './attachments.ts';
import { createBackupStore } from './backups.ts';
import { BookFiles } from './book-files.ts';
import { createBookStores } from './books.ts';
import { createBookmarkStore } from './bookmarks.ts';
import { createClientUpdateStore } from './client-updates.ts';
import { createContactMessageStore } from './contact-messages.ts';
import { createDailySettingsStore } from './daily-settings.ts';
import { MEMORY_DATABASE, openDatabase } from './db.ts';
import { createDeviceKeyStore } from './device-keys.ts';
import { createDeviceStore } from './devices.ts';
import { createDeviceTimeZoneStore } from './device-time-zones.ts';
import { createOwnerAccountStore } from './owner-account.ts';
import { createCalendarSnapshotStore } from './calendar-snapshots.ts';
import { createFeedCommentStore } from './feed-comments.ts';
import { createFeedFetchRuns } from './feed-fetch-runs.ts';
import { createFeedItemStore } from './feed-items.ts';
import { createFeedSourceStatusStore } from './feed-source-status.ts';
import { createFeedSourceStore } from './feed-sources.ts';
import { createInboxStores } from './inbox.ts';
import { createIntakeStores } from './intake.ts';
import { createKernelSettingsStores } from './kernel-settings.ts';
import { createLegacyIdMap } from './legacy-ids.ts';
import { createLegacyRowStore } from './legacy-rows.ts';
import { createLineApprovalStore } from './line-approvals.ts';
import { createLineStores } from './lines.ts';
import { createMaintenanceOperationStore } from './maintenance-operations.ts';
import { createMemoryCurationStores } from './memory-curation.ts';
import { createMemoryDocStores } from './memory-docs.ts';
import { createMemoryDreamStore } from './memory-dreams.ts';
import { createMemoryJournalStore } from './memory-journal.ts';
import { createMemoryStore } from './memory.ts';
import { appliedMigrations, migrate, MIGRATIONS, type MigrationFiles } from './migrations/index.ts';
import { createMoneyDraftStore } from './money-drafts.ts';
import { createMoneyStores } from './money.ts';
import { createGroupStores } from './groups.ts';
import { createNetworkTaskStores } from './network-tasks.ts';
import { createNetworkStores } from './network.ts';
import { createNodeActionStore } from './node-actions.ts';
import { createNodePairingCodeStore } from './node-pairing-codes.ts';
import { createNodeStore } from './nodes.ts';
import { createOutboundStores } from './outbound.ts';
import { NoteBodies } from './note-bodies.ts';
import { createNoteStore } from './notes.ts';
import type { StoreContext } from './object-store.ts';
import { createPairingCodeStore } from './pairing-codes.ts';
import { createProjectStore } from './projects.ts';
import { createPushSubscriptionStore } from './push-subscriptions.ts';
import { createReceiptStore } from './receipts.ts';
import { createSearchIndex, type SearchIndex } from './search-index.ts';
import { createSearchStore } from './search.ts';
import { createScheduleStores } from './schedules.ts';
import { createSessionStore } from './sessions.ts';
import { createSpaceRewriteStore } from './space-rewrites.ts';
import { createSpaceStore } from './spaces.ts';
import { createMateStores } from './mates.ts';
import { createMemoryCleanupStore } from './memory-cleanups.ts';
import { createMemoryConflictStore } from './memory-conflicts.ts';
import { createLibraryPurge } from './library-purge.ts';
import { createSubscriptionStore } from './subscriptions.ts';
import { createSuggestionStore } from './suggestions.ts';
import { createTimedSlotStore } from './timed-slots.ts';
import { createHeartbeatFacts } from './heartbeat-facts.ts';
import { createLoopStore } from './loop.ts';
import { createSoulStore } from './souls.ts';
import { createSystemOperationsStore } from './system-operations.ts';
import { createTermDecodings } from './term-decodings.ts';
import { createToolGroupStore } from './tool-groups.ts';
import { createTranslateSettingsStore } from './translate-settings.ts';
import { createTranslationCache } from './translation-cache.ts';
import { createVersionReader } from './versions.ts';
import { createFaviconStore } from './favicons.ts';
import { createWebTabsStore } from './web-tabs.ts';

export interface OpenStateOptions {
  /** File path of plasticine.sqlite, or ':memory:' in tests. */
  path: string;
  /** ISO time source; tests pin it. */
  now?: () => string;
  newId?: () => string;
  /**
   * Where note bodies live (rule 5: the text stays a file). Defaults to `notes/` next to the library file; an
   * in-memory library has none unless one is given, and then refuses to store notes.
   */
  notesDirectory?: string;
  /** 书的文件（图书，2026-11-01）：默认是库文件旁边的 books/；内存库没有，除非测试给一个。 */
  booksDirectory?: string;
  enforceBackupOwner?: boolean;
}

/** The state directory layout: plasticine.sqlite and notes/ side by side. */
export const NOTES_DIRECTORY = 'notes';
export const BOOKS_DIRECTORY = 'books';

function booksDirectoryFor(options: OpenStateOptions): string | undefined {
  if (options.booksDirectory !== undefined) {
    return options.booksDirectory;
  }
  return options.path === MEMORY_DATABASE ? undefined : join(dirname(options.path), BOOKS_DIRECTORY);
}

function notesDirectoryFor(options: OpenStateOptions): string | undefined {
  if (options.notesDirectory !== undefined) {
    return options.notesDirectory;
  }
  return options.path === MEMORY_DATABASE ? undefined : join(dirname(options.path), NOTES_DIRECTORY);
}

function buildStores(context: StoreContext, notes: NoteBodies, index: SearchIndex,
  attachmentDirectory: string | undefined) {
  return {
    // 统一全文索引（《优化清单》第 20 条）：⌘K、翻对话、记忆的默认搜索都查它。
    search: createSearchStore(context, index),
    systemOperations: createSystemOperationsStore(context),
    // 第 115 条：长期维护入口的操作记录（迁移 0050）。
    maintenanceOperations: createMaintenanceOperationStore(context),
    projects: createProjectStore(context),
    // 书签（第 110 条）：网页、页面、保存的分组；信息流收藏 2026-11-04 起和书签分开。
    bookmarks: createBookmarkStore(context),
    // 竖排网页标签的摆放（11-08 起存在本体里，迁移 0109）和网站图标的缓存（0110）。
    webTabs: createWebTabsStore(context),
    favicons: createFaviconStore(context),
    agreements: createAgreementStore(context),
    termDecodings: createTermDecodings(context),
    attachments: createAttachmentStore(context, attachmentDirectory),
    networkAttachments: createNetworkAttachmentStore(context),
    moneyDrafts: createMoneyDraftStore(context),
    clientUpdates: createClientUpdateStore(context),
    // 旧的记忆条目（只读，后台整理进主题文档）。
    memory: createMemoryStore(context),
    // 记忆文档（用户 2026-11-02 定）：按主题整理的活文档，和后台整理的队列、推断、迁移进度。
    memoryDocs: createMemoryDocStores(context),
    memoryConflicts: createMemoryConflictStore(context),
    memoryCleanups: createMemoryCleanupStore(context),
    memoryCuration: createMemoryCurationStores(context),
    // 第 10、16 条（11-06 定）：白天只记的「今天的记录」，和夜里整理的「昨晚整理了什么」。
    memoryJournal: createMemoryJournalStore(context),
    memoryDreams: createMemoryDreamStore(context),
    versions: createVersionReader(context.db),
    // 对外动作的回执幂等（站内回信、云端浏览器操作、通知信，system/external-once.ts）。
    receipts: createReceiptStore(context),
    legacyIds: createLegacyIdMap(context),
    legacyRows: createLegacyRowStore(context),
    devices: createDeviceStore(context),
    deviceKeys: createDeviceKeyStore(context),
    pairingCodes: createPairingCodeStore(context),
    sessions: createSessionStore(context),
    apiRequests: createApiRequestLog(context),
    notes: createNoteStore(context, notes),
    // 第 6、7 条（11-06 定）：Plasticine 写的都是空间；订阅（研究周报、个人回顾）每一期是一个空间。
    spaces: createSpaceStore(context),
    // 第 8 批第 6 条：旧空间按新版式重写的记录（做成了不再做，失败的下次启动再试）。
    spaceRewrites: createSpaceRewriteStore(context),
    subscriptions: createSubscriptionStore(context),
    asks: createAskStore(context),
    pushSubscriptions: createPushSubscriptionStore(context),
    feedSources: createFeedSourceStore(context),
    feedFetchRuns: createFeedFetchRuns(context),
    feedSourceStatus: createFeedSourceStatusStore(context),
    feedItems: createFeedItemStore(context),
    feedComments: createFeedCommentStore(context),
    // 第 8 条：信息流的中文；第 9 条：视频解析与抖音收藏。
    feedTranslations: createFeedTranslationStore(context),
    ...createVideoStores(context),
    dailySettings: createDailySettingsStore(context),
    // M5 甲路：执行节点、节点配对码、设备动作。
    nodes: createNodeStore(context),
    nodePairingCodes: createNodePairingCodeStore(context),
    nodeActions: createNodeActionStore(context),
    ...createOutboundStores(context),
    // M5 乙路：记账、站内信、工具组。
    ...createMoneyStores(context),
    ...createInboxStores(context),
    toolGroups: createToolGroupStore(context),
    // 通知信的开关（用户 2026-11-01 定的「邮件兜底」，现在管项目逾期 / 停滞提醒信）。
    // 沉浸式翻译（2026-11-03 第 2 批）：设置一行和译文缓存。
    translateSettings: createTranslateSettingsStore(context),
    translationCache: createTranslationCache(context),
    // 进门（第 102 条）：来源、触发、去向、规则。命中规则开后台线。
    ...createIntakeStores(context),
    // 联系人与 Cyber Hunter 网络（第 113 条）：账号、联系人、信、跨用户任务、档位、分身说过的话。
    ...createNetworkStores(context),
    contactMessages: createContactMessageStore(context),
    ...createNetworkTaskStores(context),
    ...createGroupStores(context),
    // 新内核（2026-11-05 Harness 重做）：线、线里的消息、排队、硬线的一次性批准、设置与模型凭证。
    ...createLineStores(context),
    ...createMateStores(context),
    lineApprovals: createLineApprovalStore(context),
    ...createKernelSettingsStores(context),
    // 任务栏目（《优化清单》第 3、4 条）：定时线、照卡发送的记录、建议，和他设备当前的时区。
    ...createScheduleStores(context),
    suggestions: createSuggestionStore(context),
    timedSlots: createTimedSlotStore(context),
    heartbeatFacts: createHeartbeatFacts(context),
    // 预测闭环（11-13，迁移 0135）：记预测和他的反应、放手、做梦写的说明书。
    loop: createLoopStore(context),
    // 主线和每位队友各一份 Soul 和改动记录（第13批，迁移 0139）。
    souls: createSoulStore(context),
    deviceTimeZones: createDeviceTimeZoneStore(context),
    // 主人账号（2026-11-08《首次使用流程》）：名字、密码哈希、建账号令牌。
    ownerAccount: createOwnerAccountStore(context),
    calendarSnapshots: createCalendarSnapshotStore(context),
  };
}

/** 迁移写笔记正文（0061 把产出迁成笔记）：和新建笔记一样，先写文件再写行。 */
function migrationFiles(bodies: NoteBodies): MigrationFiles {
  return {
    writeNoteBody(noteId, markdown) {
      const file = bodies.fileFor(noteId);
      const digest = bodies.write(file, markdown);
      return { file, bytes: digest.bytes, sha256: digest.sha256 };
    },
    readNoteBody: (file) => bodies.read(file),
  };
}

export function openState(options: OpenStateOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const db = openDatabase(options.path);
  const noteBodies = new NoteBodies(notesDirectoryFor(options));
  let newlyApplied: string[];
  try {
    newlyApplied = migrate(db, MIGRATIONS, now, migrationFiles(noteBodies));
  } catch (error) {
    db.close();
    throw error;
  }
  const index = createSearchIndex(db, noteBodies);
  // 写路径在各自的事务里告诉索引；还没回填过的来源在这里分批回填（一次读一批，不整表进内存）。
  const context: StoreContext = { db, now, newId: options.newId ?? randomUUID, index };
  try {
    index.backfill();
  } catch (error) {
    db.close();
    throw error;
  }
  const notesDirectory = notesDirectoryFor(options);
  const bookFiles = new BookFiles(booksDirectoryFor(options));
  const stores = buildStores(context, noteBodies, index,
    options.path === MEMORY_DATABASE ? undefined : join(dirname(options.path), 'attachments'));
  return {
    ...stores,
    ...createBookStores(context, bookFiles),
    libraryPurge: createLibraryPurge(context, noteBodies, bookFiles, stores.spaces.changed),
    backups: createBackupStore(context, {
      ...(options.path === MEMORY_DATABASE ? {} : { directory: join(dirname(options.path), 'backups') }),
      ...(notesDirectory === undefined ? {} : { notesDirectory }),
      enforceOwner: options.enforceBackupOwner ?? false,
    }),
    /** Migrations this open applied; empty when the library was already current. */
    newlyApplied,
    schemaVersion: (): string[] => appliedMigrations(db),
    /** Runs `work` atomically, e.g. a task's status change together with its task_events row (harness 5.3). */
    transaction: <T>(work: () => T): T => db.transaction(work),
    /** 同 transaction，期间删掉、改掉的内容用零覆盖（11-07 他定「删除」真的抹掉；只给「忘掉」用）。 */
    erasing: <T>(work: () => T): T => db.erasing(work),
    close: (): void => db.close(),
  };
}

export type StateService = ReturnType<typeof openState>;
