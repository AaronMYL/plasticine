import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
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
import { createClientPublicationStore } from './client-publications.ts';
import { createContactMessageStore } from './contact-messages.ts';
import { createDailySettingsStore } from './daily-settings.ts';
import { MEMORY_DATABASE, openDatabase } from './db.ts';
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
import { createKernelSettingsStores } from './kernel-settings.ts';
import { createModelCallStore } from './model-calls.ts';
import { createLegacyIdMap } from './legacy-ids.ts';
import { createLegacyRowStore } from './legacy-rows.ts';
import { createLineApprovalStore } from './line-approvals.ts';
import { createLineStores } from './lines.ts';
import { createLinePlanStore } from './line-plans.ts';
import { createPushStore } from './pushes.ts';
import { createConnectionStore } from './connections.ts';
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
import { createLineTimerStores } from './line-timers.ts';
import { createNodeActionStore } from './node-actions.ts';
import { createNodePairingCodeStore } from './node-pairing-codes.ts';
import { createNodeStore } from './nodes.ts';
import { createOutboundStores } from './outbound.ts';
import { NoteBodies } from './note-bodies.ts';
import { createNoteStore } from './notes.ts';
import type { StoreContext } from './object-store.ts';
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
    search: createSearchStore(context, index),
    systemOperations: createSystemOperationsStore(context),
    maintenanceOperations: createMaintenanceOperationStore(context),
    projects: createProjectStore(context),
    bookmarks: createBookmarkStore(context),
    webTabs: createWebTabsStore(context),
    favicons: createFaviconStore(context),
    attachments: createAttachmentStore(context, attachmentDirectory),
    networkAttachments: createNetworkAttachmentStore(context),
    moneyDrafts: createMoneyDraftStore(context),
    clientPublications: createClientPublicationStore(context),
    memory: createMemoryStore(context),
    memoryDocs: createMemoryDocStores(context),
    memoryConflicts: createMemoryConflictStore(context),
    memoryCleanups: createMemoryCleanupStore(context),
    memoryCuration: createMemoryCurationStores(context),
    memoryJournal: createMemoryJournalStore(context),
    memoryDreams: createMemoryDreamStore(context),
    versions: createVersionReader(context.db),
    receipts: createReceiptStore(context),
    legacyIds: createLegacyIdMap(context),
    legacyRows: createLegacyRowStore(context),
    devices: createDeviceStore(context),
    sessions: createSessionStore(context),
    apiRequests: createApiRequestLog(context),
    notes: createNoteStore(context, notes),
    spaces: createSpaceStore(context),
    spaceRewrites: createSpaceRewriteStore(context),
    subscriptions: createSubscriptionStore(context),
    asks: createAskStore(context),
    pushSubscriptions: createPushSubscriptionStore(context),
    feedSources: createFeedSourceStore(context),
    feedFetchRuns: createFeedFetchRuns(context),
    feedSourceStatus: createFeedSourceStatusStore(context),
    feedItems: createFeedItemStore(context),
    feedComments: createFeedCommentStore(context),
    feedTranslations: createFeedTranslationStore(context),
    ...createVideoStores(context),
    dailySettings: createDailySettingsStore(context),
    nodes: createNodeStore(context),
    nodePairingCodes: createNodePairingCodeStore(context),
    nodeActions: createNodeActionStore(context),
    ...createOutboundStores(context),
    ...createMoneyStores(context),
    ...createInboxStores(context),
    toolGroups: createToolGroupStore(context),
    lineTimers: createLineTimerStores(context),
    linePlans: createLinePlanStore(context),
    pushes: createPushStore(context),
    connections: createConnectionStore(context),
    translateSettings: createTranslateSettingsStore(context),
    translationCache: createTranslationCache(context),
    ...createNetworkStores(context),
    contactMessages: createContactMessageStore(context),
    ...createNetworkTaskStores(context),
    ...createGroupStores(context),
    ...createLineStores(context),
    ...createMateStores(context),
    lineApprovals: createLineApprovalStore(context),
    ...createKernelSettingsStores(context),
    modelCalls: createModelCallStore(context),
    ...createScheduleStores(context),
    suggestions: createSuggestionStore(context),
    timedSlots: createTimedSlotStore(context),
    heartbeatFacts: createHeartbeatFacts(context),
    loop: createLoopStore(context),
    souls: createSoulStore(context),
    deviceTimeZones: createDeviceTimeZoneStore(context),
    ownerAccount: createOwnerAccountStore(context),
    calendarSnapshots: createCalendarSnapshotStore(context),
  };
}

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
    snapshotTo: (path: string): void => {
      db.run('VACUUM INTO $path', { path });
    },
    /** Runs `work` atomically, e.g. a task's status change together with its task_events row (harness 5.3). */
    transaction: <T>(work: () => T): T => db.transaction(work),
    erasing: <T>(work: () => T): T => db.erasing(work),
    close: (): void => db.close(),
  };
}

export type StateService = ReturnType<typeof openState>;
