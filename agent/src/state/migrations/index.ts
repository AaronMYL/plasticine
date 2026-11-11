import { migration as networkAttachments } from './0127-network-attachments.ts';
// The ordered list of schema migrations. Append only: a shipped migration is never edited or removed.

import { migration as lineArchive } from './0066-line-archive.ts';
import { migration as searchIndex } from './0067-search-index.ts';
import { migration as memoryLayers } from './0070-memory-layers.ts';
import { migration as memoryJournal } from './0071-memory-journal.ts';
import { migration as memoryDreams } from './0072-memory-dreams.ts';
import { migration as lineVerdict } from './0077-line-verdict.ts';
import { migration as schedules } from './0079-schedules.ts';
import { migration as scheduleSends } from './0080-schedule-sends.ts';
import { migration as outboundGrants } from './0126-outbound-grants.ts';
import { migration as spaceWriter } from './0129-space-writer.ts';
import { migration as memoryScope } from './0130-memory-scope.ts';
import { migration as videoCover } from './0131-video-cover.ts';
import { migration as mates } from './0128-mates.ts';
import { migration as suggestions } from './0081-suggestions.ts';
import { migration as deviceTimeZones } from './0082-device-time-zones.ts';
import { migration as spaces } from './0083-spaces.ts';
import { migration as aiNotesToSpaces } from './0084-ai-notes-to-spaces.ts';
import { migration as lineDays } from './0087-line-days.ts';
import { migration as sideLines } from './0088-side-lines.ts';
import { migration as linePurpose } from './0090-line-purpose.ts';
import { migration as timedSlots } from './0091-timed-slots.ts';
import { migration as rulesToHeartbeat } from './0092-rules-to-heartbeat.ts';
import { migration as feedTranslations } from './0094-feed-translations.ts';
import { migration as videoWorks } from './0095-video-works.ts';
import { migration as eraseDeletedMemory } from './0098-erase-deleted-memory.ts';
import { migration as archiveSelfChangeMemory } from './0103-archive-self-change-memory.ts';
import { migration as plasticineProjectGoal } from './0104-plasticine-project-goal.ts';
import { migration as calendarSnapshots } from './0106-calendar-snapshots.ts';
import { migration as webTabs } from './0109-web-tabs.ts';
import { migration as favicons } from './0110-favicons.ts';
import { migration as ownerAccount } from './0111-owner-account.ts';
import { migration as deviceLocal } from './0112-device-local.ts';
import { migration as feedSourceRemoved } from './0113-feed-source-removed.ts';
import { migration as noteSuggestThinking } from './0120-note-suggest-thinking.ts';
import { migration as bookmarksApart } from './0121-bookmarks-apart.ts';
import { migration as contentMetadata } from './0124-content-metadata.ts';
import { migration as videoCollectionOrder } from './0123-video-collection-order.ts';
import { migration as libraryPurge } from './0125-library-purge.ts';
import { migration as spacePages } from './0122-space-pages.ts';
import { migration as objects } from './0001-objects.ts';
import { migration as tasks } from './0002-tasks.ts';
import { migration as records } from './0003-records.ts';
import { migration as app } from './0004-app.ts';
import { migration as notes } from './0005-notes.ts';
import { migration as tasksAsks } from './0006-tasks-asks.ts';
import { migration as taskHistory } from './0007-task-history.ts';
import { migration as memoryJudgments } from './0008-memory-judgments.ts';
import { migration as concernsDaily } from './0009-concerns-daily.ts';
import { migration as triggerGenerations } from './0010-trigger-generations.ts';
import { migration as devicesSelf } from './0011-devices-self.ts';
import { migration as lifeInboxArtifacts } from './0012-life-inbox-artifacts.ts';
import { migration as readingToManual } from './0013-reading-to-manual.ts';
import { migration as disagreementProposals } from './0022-disagreement-proposals.ts';
import type { Migration } from './migrate.ts';
import { migration as noteHistory } from './0014-note-history.ts';
import { migration as terms } from './0015-terms.ts';
import { migration as forecasts } from './0016-forecasts.ts';
import { migration as attachments } from './0017-attachments.ts';
import { migration as moneyDrafts } from './0018-money-drafts.ts';
import { migration as improvements } from './0019-improvements.ts';
import { migration as clientUpdates } from './0020-client-updates.ts';
import { migration as backups } from './0021-backups.ts';
import { migration as externalFeed } from './0023-external-feed.ts';
import { migration as activation } from './0024-activation.ts';
import { migration as selfCode } from './0025-self-code.ts';
import { migration as feedSearch } from './0026-feed-search.ts';
import { migration as selfCodeEnabled } from './0027-self-code-enabled.ts';
import { migration as nodeChannel } from './0028-node-channel.ts';
import { migration as taskOrigins } from './0029-task-origins.ts';
import { migration as taskWorkchain } from './0030-task-workchain.ts';
import { migration as cognitionWork } from './0032-cognition-work.ts';
import { migration as noteFolders } from './0031-note-folders.ts';

import { migration as feedComments } from './0034-feed-comments.ts';
import { migration as systemsWork } from './0033-systems-work.ts';
import { migration as briefDisagreements } from './0035-brief-disagreements.ts';
import { migration as mailFallback } from './0036-mail-fallback.ts';
import { migration as books } from './0037-books.ts';
import { migration as projects } from './0038-projects.ts';
import { migration as memoryDocs } from './0040-memory-docs.ts';
import { migration as taskContracts } from './0041-task-contracts.ts';
import { migration as deviceLanes } from './0042-device-lanes.ts';
import { migration as things } from './0043-things.ts';
import { migration as messageWidgets } from './0044-message-widgets.ts';
import { migration as bookmarks } from './0045-bookmarks.ts';
import { migration as translations } from './0046-translations.ts';
import { migration as contactsNetwork } from './0047-contacts-network.ts';
import { migration as ownNotices } from './0048-own-notices.ts';
import { migration as ownNoticeTwins } from './0049-own-notice-twins.ts';
import { migration as maintenance } from './0050-maintenance.ts';
import { migration as feedSavesApart } from './0051-feed-saves-apart.ts';
import { migration as mailBodies } from './0052-mail-bodies.ts';
import { migration as reminderNotices } from './0053-reminder-notices.ts';
import { migration as feedSourcesX } from './0054-feed-sources-x.ts';
import { migration as selfExpectations } from './0055-self-expectations.ts';
import { migration as askBasis } from './0057-ask-basis.ts';
import { migration as lines } from './0058-lines.ts';
import { migration as mainLine } from './0059-main-line.ts';
import { migration as projectTodos } from './0060-project-todos.ts';
import { migration as artifactNotes } from './0061-artifact-notes.ts';
import { migration as dropRetired } from './0062-drop-retired.ts';
import { migration as lineMessageMeta } from './0063-line-message-meta.ts';
import { migration as networkGroups } from './0064-network-groups.ts';
import { migration as lineControlAndOrigins } from './0065-line-control-and-origins.ts';

export const MIGRATIONS: readonly Migration[] = [
  objects,
  tasks,
  records,
  app,
  notes,
  tasksAsks,
  taskHistory,
  memoryJudgments,
  concernsDaily,
  triggerGenerations,
  devicesSelf,
  lifeInboxArtifacts,
  readingToManual,
  noteHistory,
  terms,
  forecasts,
  attachments,
  moneyDrafts,
  improvements,
  clientUpdates,
  backups,
  disagreementProposals,
  externalFeed,
  activation,
  selfCode,
  feedSearch,
  selfCodeEnabled,
  nodeChannel,
  taskOrigins,
  taskWorkchain,
  noteFolders,
  cognitionWork,
  systemsWork,
  feedComments,
  briefDisagreements,
  mailFallback,
  books,
  projects,
  memoryDocs,
  taskContracts,
  deviceLanes,
  things,
  messageWidgets,
  bookmarks,
  translations,
  contactsNetwork,
  ownNotices,
  ownNoticeTwins,
  maintenance,
  feedSavesApart,
  mailBodies,
  reminderNotices,
  feedSourcesX,
  selfExpectations,
  askBasis,
  lines,
  mainLine,
  projectTodos,
  artifactNotes,
  dropRetired,
  lineMessageMeta,
  networkGroups,
  lineControlAndOrigins,
  lineArchive,
  searchIndex,
  memoryLayers,
  memoryJournal,
  memoryDreams,
  lineVerdict,
  schedules,
  scheduleSends,
  suggestions,
  deviceTimeZones,
  spaces,
  aiNotesToSpaces,
  lineDays,
  sideLines,
  linePurpose,
  timedSlots,
  rulesToHeartbeat,
  feedTranslations,
  videoWorks,
  eraseDeletedMemory,
  archiveSelfChangeMemory,
  plasticineProjectGoal,
  calendarSnapshots,
  webTabs,
  favicons,
  ownerAccount,
  deviceLocal,
  feedSourceRemoved,
  noteSuggestThinking,
  bookmarksApart,
  spacePages,
  videoCollectionOrder,
  contentMetadata,
  libraryPurge,
  outboundGrants,
  networkAttachments,
  mates,
  spaceWriter,
  memoryScope,
  videoCover,
];

export { appliedMigrations, migrate } from './migrate.ts';
export type { Migration, MigrationDb, MigrationFiles } from './migrate.ts';
