import { composeOutcome, predictCompose } from './compose.ts';
import { SOUL_ROUTES } from './soul.ts';
import { SOULS_ROUTES } from './souls.ts';
import { RULES_MOVE_ROUTES } from './rules-move.ts';
import { MEMORY_CONFLICT_ROUTES } from './memory-conflicts.ts';
import { MEMORY_GRANTS_ROUTES } from './memory-grants.ts';
import { MEMORY_LAYERS_ROUTES } from './memory-layers.ts';
import { MEMORY_MANAGE_ROUTES } from './memory-manage.ts';
import { getLinkPreview } from './link-preview.ts';
import { getProxiedImage } from './image-proxy.ts';
import {
  OUTBOUND_GRANTS_PATH,
  OUTBOUND_LOG_PATH,
  ACCOUNT_HANDLES_PATH,
  ACCOUNT_OWN_URL_PATH,
  ACCOUNT_WORK_LIMIT_PATH,
  DIRECT_OFFER_PATH,
  ACCOUNT_PASSWORD_PATH,
  ACCOUNT_PATH,
  ACCOUNT_SETUP_PATH,
  ACCOUNT_STATE_PATH,
  LOCAL_SESSION_PATH,
  PASSWORD_SESSION_PATH,
  ACTIONS_PATH,
  ASKS_PATH,
  BOOKMARKS_IMPORT_PATH,
  BOOKMARKS_ORDER_PATH,
  BOOKMARKS_PATH,
  FAVICON_PATH,
  WEB_TABS_MERGE_PATH,
  WEB_TABS_PATH,
  BOOKS_PATH,
  BROWSER_ACK_PATH,
  BROWSER_ACTIONS_PATH,
  BROWSER_FRAME_PATH,
  BROWSER_OPEN_PATH,
  BROWSER_PATH,
  BROWSER_STREAM_PATH,
  BROWSER_TABS_PATH,
  DEVICES_PATH,
  EVENTS_PATH,
  FEED_ITEMS_PATH,
  FEED_PATH,
  FEED_NAV_PATH,
  DOUYIN_NODE_PATH,
  DOUYIN_PATH,
  TRANSCRIBER_INSTALL_PATH,
  TRANSCRIBER_PATH,
  DOUYIN_PROCESS_PATH,
  DOUYIN_SYNC_PATH,
  FEED_REFRESH_PATH,
  FEED_SOURCES_PATH,
  FEED_REDDIT_PATH,
  FEED_REDDIT_PREVIEW_PATH,
  FILES_CONTENT_PATH,
  FILES_FOLDERS_PATH,
  FILES_MOVE_PATH,
  FILES_PATH,
  FILES_RESTORE_PATH,
  FILES_TABLE_PATH,
  FILES_TRASH_PATH,
  FILES_UPLOAD_PATH,
  HOME_PATH,
  INBOX_PATH,
  INBOX_READ_ALL_PATH,
  INBOX_REPLIES_PATH,
  MEMORY_DOCS_PATH,
  MEMORY_DREAMS_PATH,
  MEMORY_ENTRIES_PATH,
  MEMORY_INFERENCES_PATH,
  MEMORY_PATH,
  MEMORY_SEARCH_PATH,
  MEMORY_TOPICS_PATH,
  MEMORY_UNCERTAIN_PATH,
  MONEY_ACCOUNTS_PATH,
  MONEY_DRAFT_SUMMARY_PATH,
  MONEY_ENTRIES_PATH,
  MONEY_ORIGINALS_PURGE_PATH,
  MONEY_PATH,
  MONEY_STATS_PATH,
  NODE_ACTIONS_PATH,
  NODE_HELLO_PATH,
  NODE_LOGS_PATH,
  NODE_NEXT_ACTION_PATH,
  NODE_PAIR_PATH,
  NODE_PAIRING_CODES_PATH,
  NODES_PATH,
  NOTE_ASSETS_PATH,
  NOTES_EXPORT_PATH,
  NOTES_IMPORT_PATH,
  NOTES_PATH,
  PAGE_RENDER_PATH,
  SPACES_EXPORT_PATH,
  SPACES_IMPORT_PATH,
  COMPOSE_OUTCOME_PATH,
  COMPOSE_PREDICT_PATH,
  PROJECTS_PATH,
  PUSH_KEY_PATH,
  PUSH_SUBSCRIPTIONS_PATH,
  PUSH_TEST_PATH,
  NOTIFY_KINDS_PATH,
  PRESENCE_PATH,
  SEARCH_PATH,
  SESSION_PATH,
  NODE_BROWSER_SESSION_PATH,
  SKILLS_PATH,
  SKILL_DRAFT_PATH,
  SKILL_INSTALL_PATH,
  SKILL_PREVIEW_PATH,
  SKILL_STORE_PATH,
  TODAY_SETTINGS_PATH,
  TOOL_GROUPS_PATH,
  IMAGE_PROXY_PATH,
} from '../../shared/api/index.ts';
import { createOutboundGrant, editOutboundGrant, getOutboundLog, listOutboundGrants, listOutboundLog,
  revokeOutboundGrant } from './outbound-grants.ts';
import { REVIEW_PATH, SPACES_PATH, SUBSCRIPTIONS_PATH } from '../../shared/api/spaces.ts';
import { deleteSpace, getSpace, getSpaceVersions, listSpaces, restoreSpace, saveSpace, undoSpace } from './spaces.ts';
import { LIBRARY_TRASH_PATH } from '../../shared/api/library.ts';
import { listLibraryTrash } from './library-trash.ts';
import { LIBRARY_BATCH_PATH, LIBRARY_EMPTY_PATH, NOTES_BATCH_PATH, NOTES_EMPTY_PATH }
  from '../../shared/api/library-batch.ts';
import { batchLibrary, batchNotes, emptyLibrary, emptyNotes } from './library-batch.ts';
import { adoptSubscriptionRule, getReviewSummary, getSubscription, listSubscriptions, runSubscriptionNow,
  updateSubscription } from './subscriptions.ts';
import { TRANSLATE_MODEL_PATH, TRANSLATE_PATH, TRANSLATE_SETTINGS_PATH } from '../../shared/api/translate.ts';
import { ApiError } from './api-error.ts';
import { answerAsk, askAboutAsk, deferAsk, feedbackAsk, getAsk, listAsks } from './asks.ts';
import { completeUpload, getAttachment, getAttachmentContent, getAttachmentText, lookupAttachment, openUpload,
  uploadChunk } from './attachments.ts';
import { createBackup, getBackup, getRestorePreview, listBackups, previewRestore, restoreBackup } from './backups.ts';
import {
  applyImport, cancelExport, cancelImport, completeImport, downloadExport, importChunk, migrationStatus, startExport,
  startImport, undoMigration, unlockImport,
} from './migration.ts';
import { createBookAnnotation, deleteBookAnnotation, dismissKeyPoint, exportBookNotes, generateBookInsight,
  getBookInsight, listBookAnnotations, listBookDiscussions, updateBookAnnotation } from './book-notes.ts';
import { addBookmark, editBookmark, importBookmarks, listBookmarks, orderBookmarks, removeBookmark,
  restoreBookmark } from './bookmarks.ts';
import { getFavicon, getWebTabs, mergeWebTabs, putFavicon, putWebTabs } from './web-tabs.ts';
import { deleteBook, getBook, getBookAsset, getBookChapter, listBooks, renameBook, restoreBook, saveBookProgress,
  searchInBook, uploadBook } from './books.ts';
import { WEB_EXTRACT_PATH, WEB_ARCHIVE_PATH } from '../../shared/api/web-extract.ts';
import { extractBrowserPage, archiveBrowserPage } from './web-extract.ts';
import { ackBrowser, streamBrowser } from './browser-stream.ts';
import { actBrowser, getBrowser, getBrowserFrame, openBrowser, settleAction, tabBrowser } from './browser.ts';
import { createSkill, draftSkillRequest, getSkill, installSkill, listSkills, listSkillStore, previewSkill, removeSkill }
  from './skills.ts';
import { clientVersion } from './client-updates.ts';
import { CONTACT_ROUTES } from './contact-routes.ts';
import type { HttpMethod, Route } from './context.ts';
import { listDevices, revokeDevice } from './devices.ts';
import { getAccountState, handleAvailability, patchAccount, setAccountPassword } from './account.ts';
import { getOwnUrl, putOwnUrl } from './own-url.ts';
import { getWorkLimit, putWorkLimit } from './work-limit.ts';
import { directOffer } from './direct-offer.ts';
import { setupAccount } from './account-setup.ts';
import { localLogin, passwordLogin } from './password-session.ts';
import { streamEvents } from './events.ts';
import { getFeedRefresh, refreshFeed } from './feed-refresh.ts';
import { addFeedComment, blockFeedSite, listFeedComments, retryFeedComment } from './feed-work.ts';
import { FEED_X_PATH, getXTimelineDue, reportXTimeline } from './feed-x.ts';
import { FEED_XHS_PATH, getXhsDue, reportXhs } from './feed-xhs.ts';
import { FEED_COMPUTER_FETCH_PATH, leaseComputerFetches, reportComputerFetch } from './feed-computer-fetch.ts';
import { addReddit, deleteFeedSource, previewReddit, refreshFeedSource, updateFeedSource } from './feed-sources.ts';
import { douyinJobs, getTranscriber, installTranscriber, listDouyin, processDouyin, reportDouyin, syncDouyin }
  from './video.ts';
import {
  addFeedItem,
  addInterest,
  addSubscription,
  feedNav,
  getFeedItem,
  listFeed,
  listFeedSources,
  reactFeedItem,
  saveFeedItem,
  setSourceLevel,
  setSourceQuery,
} from './feed.ts';
import {
  createFolder,
  downloadFile,
  listFiles,
  listTrash,
  moveFile,
  readTextFile,
  restoreFile,
  trashFile,
  uploadFile,
  writeTextFile,
} from './files.ts';
import { exportTable } from './table-export.ts';
import { health } from './health.ts';
import { getHome } from './home.ts';
import { addInboxFeedback, getInboxMessage, listInbox, readAllInbox, replyInbox, setInboxFlags, settleInboxReply,
  syncInbox } from './inbox.ts';
import { LINE_ROUTES } from './line-routes.ts';
import { TASK_ROUTES } from './task-routes.ts';
import { HEARTBEAT_ROUTES } from './heartbeat.ts';
import { CALENDAR_ROUTES } from './calendar.ts';
import { confirmMemoryInference, editMemoryLine, getMemoryDoc, getMemoryDocDirectory, listMemoryInferences,
  rejectMemoryInference, retireMemoryLine } from './memory-docs.ts';
import { answerUncertain, getMemoryTopic, listMemoryTopics } from './memory-topics.ts';
import { chooseMemoryDreamChange, latestMemoryDream, searchMemoryLines, undoMemoryDreamChange }
  from './memory-library.ts';
import { getMemoryBoard, getMemoryEntry, listMemoryEntries } from './memory.ts';
import { confirmMoneyDraft, createMoneyDraft, editMoneyDraft, getMoneyDraft, getMoneyDraftSummary,
  purgeMoneyOriginals, rejectMoneyDraft } from './money-drafts.ts';
import { addMoneyAccount, editMoney, editMoneyAccount, getMoney, getMoneyStats, recordMoney, removeMoney }
  from './money.ts';
import { nextNodeAction, reportNodeAction } from './node-actions.ts';
import { helloNodeHandler, nodeLogsHandler, pairNodeHandler } from './node-protocol.ts';
import { nodeBrowserSession } from './node-browser.ts';
import { issueNodePairingCode, listNodeActions, listNodes, revokeNodeHandler, setNodeLimitsHandler } from './nodes.ts';
import { unlockNote } from './note-access.ts';
import { exportNoteFiles, importNoteFiles } from './notes-transfer.ts';
import { exportSpaceFiles, importSpaceFiles, renderPageFile } from './spaces-transfer.ts';
import { assistNote, assistOutcome, changeNoteFolder, getNoteImport, listNoteFolders, restoreNote, uploadNoteImage }
  from './notes-workspace.ts';
import { createNote, deleteNote, getNote, getNoteAsset, getNoteVersion, listNotes, listNoteVersions, saveNote }
  from './notes.ts';
import { addProjectTodo, createProject, editProject, editProjectTodo, fileProjectItem, getProject, listProjects,
  setProjectHealth, unfileProjectItem } from './projects.ts';
import { notifyKinds, pushKey, pushStatus, reportPresence, saveNotifyKinds, subscribePush, testPush, unsubscribePush }
  from './push.ts';
import { search } from './search.ts';
import { currentSession, logout } from './session.ts';
import { getSystemOperations } from './system-operations.ts';
import { getDailySettings, updateDailySettings } from './today.ts';
import { listToolGroups, setToolGroup } from './tool-groups.ts';
import { getTranslateSettings, setTranslateSettings, translatePage } from './translate.ts';
import { getTranslateModel, setTranslateModel } from './translate-model.ts';

export const HEALTH_PATH = '/v2/health';

export const ROUTES: readonly Route[] = [
  ...SOUL_ROUTES,
  ...SOULS_ROUTES,
  ...RULES_MOVE_ROUTES,
  ...MEMORY_CONFLICT_ROUTES,
  ...MEMORY_MANAGE_ROUTES,
  ...MEMORY_GRANTS_ROUTES,
  ...MEMORY_LAYERS_ROUTES,
  { method: 'GET', path: OUTBOUND_GRANTS_PATH, auth: true, handler: listOutboundGrants },
  { method: 'POST', path: OUTBOUND_GRANTS_PATH, auth: true, handler: createOutboundGrant },
  { method: 'PUT', path: `${OUTBOUND_GRANTS_PATH}/:id`, auth: true, handler: editOutboundGrant },
  { method: 'POST', path: `${OUTBOUND_GRANTS_PATH}/:id/revoke`, auth: true, handler: revokeOutboundGrant },
  { method: 'GET', path: OUTBOUND_LOG_PATH, auth: true, handler: listOutboundLog },
  { method: 'GET', path: `${OUTBOUND_LOG_PATH}/:id`, auth: true, handler: getOutboundLog },
  ...CONTACT_ROUTES,
  ...LINE_ROUTES,
  ...TASK_ROUTES,
  ...HEARTBEAT_ROUTES,
  ...CALENDAR_ROUTES,
  { method: 'GET', path: HEALTH_PATH, auth: false, handler: health },
  { method: 'GET', path: ACCOUNT_STATE_PATH, auth: false, handler: getAccountState },
  { method: 'POST', path: ACCOUNT_SETUP_PATH, auth: false, handler: setupAccount },
  { method: 'GET', path: `${ACCOUNT_HANDLES_PATH}/:handle`, auth: false, handler: handleAvailability },
  { method: 'PUT', path: ACCOUNT_PASSWORD_PATH, auth: true, handler: setAccountPassword },
  { method: 'PATCH', path: ACCOUNT_PATH, auth: true, handler: patchAccount },
  { method: 'GET', path: ACCOUNT_OWN_URL_PATH, auth: true, handler: getOwnUrl },
  { method: 'PUT', path: ACCOUNT_OWN_URL_PATH, auth: true, handler: putOwnUrl },
  { method: 'GET', path: ACCOUNT_WORK_LIMIT_PATH, auth: true, handler: getWorkLimit },
  { method: 'PUT', path: ACCOUNT_WORK_LIMIT_PATH, auth: true, handler: putWorkLimit },
  { method: 'POST', path: DIRECT_OFFER_PATH, auth: true, handler: directOffer },
  { method: 'POST', path: PASSWORD_SESSION_PATH, auth: false, handler: passwordLogin },
  { method: 'POST', path: LOCAL_SESSION_PATH, auth: false, handler: localLogin },
  { method: 'GET', path: SESSION_PATH, auth: true, handler: currentSession },
  { method: 'DELETE', path: SESSION_PATH, auth: true, handler: logout },
  { method: 'GET', path: DEVICES_PATH, auth: true, handler: listDevices },
  { method: 'DELETE', path: `${DEVICES_PATH}/:id`, auth: true, handler: revokeDevice },
  { method: 'GET', path: EVENTS_PATH, auth: true, handler: streamEvents },
  { method: 'GET', path: SKILLS_PATH, auth: true, handler: listSkills },
  { method: 'GET', path: `${SKILLS_PATH}/:name`, auth: true, handler: getSkill },
  { method: 'DELETE', path: `${SKILLS_PATH}/:name`, auth: true, handler: removeSkill },
  { method: 'POST', path: SKILLS_PATH, auth: true, handler: createSkill },
  { method: 'GET', path: SKILL_STORE_PATH, auth: true, handler: listSkillStore },
  { method: 'POST', path: SKILL_PREVIEW_PATH, auth: true, handler: previewSkill },
  { method: 'POST', path: SKILL_INSTALL_PATH, auth: true, handler: installSkill },
  { method: 'POST', path: SKILL_DRAFT_PATH, auth: true, handler: draftSkillRequest },
  { method: 'GET', path: SEARCH_PATH, auth: true, handler: search },
  { method: 'GET', path: '/v2/system/operations', auth: true, handler: getSystemOperations },
  { method: 'GET', path: TRANSLATE_SETTINGS_PATH, auth: true, handler: getTranslateSettings },
  { method: 'PUT', path: TRANSLATE_SETTINGS_PATH, auth: true, handler: setTranslateSettings },
  { method: 'GET', path: TRANSLATE_MODEL_PATH, auth: true, handler: getTranslateModel },
  { method: 'PUT', path: TRANSLATE_MODEL_PATH, auth: true, handler: setTranslateModel },
  { method: 'POST', path: WEB_EXTRACT_PATH, auth: true, handler: extractBrowserPage },
  { method: 'POST', path: WEB_ARCHIVE_PATH, auth: true, handler: archiveBrowserPage },
  { method: 'POST', path: TRANSLATE_PATH, auth: true, handler: translatePage },
  { method: 'GET', path: '/v2/conversation/attachments/requests/:requestId', auth: true, handler: lookupAttachment },
  { method: 'POST', path: '/v2/conversation/attachments/uploads', auth: true, handler: openUpload },
  { method: 'PUT', path: '/v2/conversation/attachments/:id/chunks/:offset', auth: true, handler: uploadChunk },
  { method: 'POST', path: '/v2/conversation/attachments/:id/complete', auth: true, handler: completeUpload },
  { method: 'GET', path: '/v2/link-preview', auth: true, handler: getLinkPreview },
  { method: 'GET', path: IMAGE_PROXY_PATH, auth: true, handler: getProxiedImage },
  { method: 'GET', path: '/v2/conversation/attachments/:id', auth: true, handler: getAttachment },
  { method: 'GET', path: '/v2/conversation/attachments/:id/content', auth: true, handler: getAttachmentContent },
  { method: 'GET', path: '/v2/conversation/attachments/:id/text', auth: true, handler: getAttachmentText },
  { method: 'GET', path: '/v2/client-version', auth: true, handler: clientVersion },
  { method: 'GET', path: '/v2/backups', auth: true, handler: listBackups },
  { method: 'POST', path: '/v2/backups', auth: true, handler: createBackup },
  { method: 'GET', path: '/v2/backups/:id', auth: true, handler: getBackup },
  { method: 'POST', path: '/v2/backups/:id/restore-preview', auth: true, handler: previewRestore },
  { method: 'POST', path: '/v2/backups/:id/restore', auth: true, handler: restoreBackup },
  { method: 'GET', path: '/v2/migration', auth: true, handler: migrationStatus },
  { method: 'POST', path: '/v2/migration/export', auth: true, handler: startExport },
  { method: 'POST', path: '/v2/migration/export/cancel', auth: true, handler: cancelExport },
  { method: 'GET', path: '/v2/migration/export/file', auth: true, handler: downloadExport },
  { method: 'POST', path: '/v2/migration/import', auth: true, handler: startImport },
  { method: 'PUT', path: '/v2/migration/import/chunks/:offset', auth: true, handler: importChunk },
  { method: 'POST', path: '/v2/migration/import/complete', auth: true, handler: completeImport },
  { method: 'POST', path: '/v2/migration/import/unlock', auth: true, handler: unlockImport },
  { method: 'POST', path: '/v2/migration/import/apply', auth: true, handler: applyImport },
  { method: 'POST', path: '/v2/migration/import/cancel', auth: true, handler: cancelImport },
  { method: 'POST', path: '/v2/migration/undo', auth: true, handler: undoMigration },
  { method: 'GET', path: '/v2/restore-previews/:previewId', auth: true, handler: getRestorePreview },
  { method: 'POST', path: '/v2/money/drafts', auth: true, handler: createMoneyDraft },
  { method: 'GET', path: MONEY_DRAFT_SUMMARY_PATH, auth: true, handler: getMoneyDraftSummary },
  { method: 'POST', path: MONEY_ORIGINALS_PURGE_PATH, auth: true, handler: purgeMoneyOriginals },
  { method: 'GET', path: '/v2/money/drafts/:id', auth: true, handler: getMoneyDraft },
  { method: 'PUT', path: '/v2/money/drafts/:id', auth: true, handler: editMoneyDraft },
  { method: 'POST', path: '/v2/money/drafts/:id/confirm', auth: true, handler: confirmMoneyDraft },
  { method: 'POST', path: '/v2/money/drafts/:id/reject', auth: true, handler: rejectMoneyDraft },
  { method: 'GET', path: '/v2/files/text', auth: true, handler: readTextFile },
  { method: 'PUT', path: '/v2/files/text', auth: true, handler: writeTextFile },
  { method: 'GET', path: BOOKS_PATH, auth: true, handler: listBooks },
  { method: 'POST', path: BOOKS_PATH, auth: true, handler: uploadBook },
  { method: 'GET', path: `${BOOKS_PATH}/:id`, auth: true, handler: getBook },
  { method: 'DELETE', path: `${BOOKS_PATH}/:id`, auth: true, handler: deleteBook },
  { method: 'PATCH', path: `${BOOKS_PATH}/:id`, auth: true, handler: renameBook },
  { method: 'POST', path: `${BOOKS_PATH}/:id/restore`, auth: true, handler: restoreBook },
  { method: 'GET', path: `${BOOKS_PATH}/:id/chapters/:index`, auth: true, handler: getBookChapter },
  { method: 'GET', path: `${BOOKS_PATH}/:id/assets/:key`, auth: true, handler: getBookAsset },
  { method: 'GET', path: `${BOOKS_PATH}/:id/search`, auth: true, handler: searchInBook },
  { method: 'PUT', path: `${BOOKS_PATH}/:id/progress`, auth: true, handler: saveBookProgress },
  { method: 'GET', path: `${BOOKS_PATH}/:id/annotations`, auth: true, handler: listBookAnnotations },
  { method: 'POST', path: `${BOOKS_PATH}/:id/annotations`, auth: true, handler: createBookAnnotation },
  { method: 'PUT', path: `${BOOKS_PATH}/:id/annotations/:annotationId`, auth: true,
    handler: updateBookAnnotation },
  { method: 'DELETE', path: `${BOOKS_PATH}/:id/annotations/:annotationId`, auth: true,
    handler: deleteBookAnnotation },
  { method: 'POST', path: `${BOOKS_PATH}/:id/insights`, auth: true, handler: generateBookInsight },
  { method: 'POST', path: `${BOOKS_PATH}/:id/insights/key_points/dismiss`, auth: true, handler: dismissKeyPoint },
  { method: 'GET', path: `${BOOKS_PATH}/:id/insights/:kind`, auth: true, handler: getBookInsight },
  { method: 'GET', path: `${BOOKS_PATH}/:id/discussions`, auth: true, handler: listBookDiscussions },
  { method: 'POST', path: `${BOOKS_PATH}/:id/export`, auth: true, handler: exportBookNotes },
  { method: 'GET', path: `${NOTES_PATH}/folders`, auth: true, handler: listNoteFolders },
  { method: 'POST', path: `${NOTES_PATH}/folders`, auth: true, handler: changeNoteFolder },
  { method: 'POST', path: `${NOTES_PATH}/:id/restore`, auth: true, handler: restoreNote },
  { method: 'POST', path: `${NOTES_PATH}/:id/images`, auth: true, handler: uploadNoteImage },
  { method: 'GET', path: `${NOTES_PATH}/:id/import`, auth: true, handler: getNoteImport },
  { method: 'POST', path: `${NOTES_PATH}/:id/assist`, auth: true, handler: assistNote },
  { method: 'POST', path: `${NOTES_PATH}/:id/assist/outcome`, auth: true, handler: assistOutcome },
  { method: 'POST', path: COMPOSE_PREDICT_PATH, auth: true, handler: predictCompose },
  { method: 'POST', path: COMPOSE_OUTCOME_PATH, auth: true, handler: composeOutcome },
  { method: 'GET', path: NOTES_PATH, auth: true, handler: listNotes },
  { method: 'POST', path: NOTES_PATH, auth: true, handler: createNote },
  { method: 'POST', path: NOTES_IMPORT_PATH, auth: true, handler: importNoteFiles },
  { method: 'POST', path: NOTES_EXPORT_PATH, auth: true, handler: exportNoteFiles },
  { method: 'POST', path: `${NOTES_PATH}/:id/unlock`, auth: true, handler: unlockNote },
  { method: 'GET', path: `${NOTE_ASSETS_PATH}/:name`, auth: true, handler: getNoteAsset },
  { method: 'GET', path: `${NOTES_PATH}/:id`, auth: true, handler: getNote },
  { method: 'PUT', path: `${NOTES_PATH}/:id`, auth: true, handler: saveNote },
  { method: 'DELETE', path: `${NOTES_PATH}/:id`, auth: true, handler: deleteNote },
  { method: 'GET', path: `${NOTES_PATH}/:id/versions`, auth: true, handler: listNoteVersions },
  { method: 'GET', path: `${NOTES_PATH}/:id/versions/:version`, auth: true, handler: getNoteVersion },
  { method: 'GET', path: ASKS_PATH, auth: true, handler: listAsks },
  { method: 'GET', path: `${ASKS_PATH}/:id`, auth: true, handler: getAsk },
  { method: 'POST', path: `${ASKS_PATH}/:id/answer`, auth: true, handler: answerAsk },
  { method: 'POST', path: `${ASKS_PATH}/:id/defer`, auth: true, handler: deferAsk },
  { method: 'POST', path: `${ASKS_PATH}/:id/feedback`, auth: true, handler: feedbackAsk },
  { method: 'POST', path: `${ASKS_PATH}/:id/ask`, auth: true, handler: askAboutAsk },
  { method: 'GET', path: PUSH_KEY_PATH, auth: true, handler: pushKey },
  { method: 'GET', path: PUSH_SUBSCRIPTIONS_PATH, auth: true, handler: pushStatus },
  { method: 'POST', path: PUSH_SUBSCRIPTIONS_PATH, auth: true, handler: subscribePush },
  { method: 'DELETE', path: PUSH_SUBSCRIPTIONS_PATH, auth: true, handler: unsubscribePush },
  { method: 'POST', path: PUSH_TEST_PATH, auth: true, handler: testPush },
  { method: 'GET', path: NOTIFY_KINDS_PATH, auth: true, handler: notifyKinds },
  { method: 'PUT', path: NOTIFY_KINDS_PATH, auth: true, handler: saveNotifyKinds },
  { method: 'POST', path: PRESENCE_PATH, auth: true, handler: reportPresence },
  { method: 'GET', path: MEMORY_PATH, auth: true, handler: getMemoryBoard },
  { method: 'GET', path: MEMORY_ENTRIES_PATH, auth: true, handler: listMemoryEntries },
  { method: 'GET', path: `${MEMORY_ENTRIES_PATH}/:id`, auth: true, handler: getMemoryEntry },
  { method: 'GET', path: HOME_PATH, auth: true, handler: getHome },
  { method: 'GET', path: MEMORY_TOPICS_PATH, auth: true, handler: listMemoryTopics },
  { method: 'GET', path: `${MEMORY_TOPICS_PATH}/:id`, auth: true, handler: getMemoryTopic },
  { method: 'POST', path: `${MEMORY_UNCERTAIN_PATH}/:id`, auth: true, handler: answerUncertain },
  { method: 'GET', path: MEMORY_SEARCH_PATH, auth: true, handler: searchMemoryLines },
  { method: 'GET', path: `${MEMORY_DREAMS_PATH}/latest`, auth: true, handler: latestMemoryDream },
  { method: 'POST', path: `${MEMORY_DREAMS_PATH}/changes/:id/undo`, auth: true, handler: undoMemoryDreamChange },
  { method: 'POST', path: `${MEMORY_DREAMS_PATH}/changes/:id/choose`, auth: true, handler: chooseMemoryDreamChange },
  { method: 'GET', path: SPACES_PATH, auth: true, handler: listSpaces },
  { method: 'POST', path: SPACES_IMPORT_PATH, auth: true, handler: importSpaceFiles },
  { method: 'POST', path: SPACES_EXPORT_PATH, auth: true, handler: exportSpaceFiles },
  { method: 'POST', path: PAGE_RENDER_PATH, auth: true, handler: renderPageFile },
  { method: 'GET', path: `${SPACES_PATH}/:id`, auth: true, handler: getSpace },
  { method: 'GET', path: `${SPACES_PATH}/:id/versions`, auth: true, handler: getSpaceVersions },
  { method: 'PUT', path: `${SPACES_PATH}/:id`, auth: true, handler: saveSpace },
  { method: 'POST', path: `${SPACES_PATH}/:id/undo`, auth: true, handler: undoSpace },
  { method: 'DELETE', path: `${SPACES_PATH}/:id`, auth: true, handler: deleteSpace },
  { method: 'POST', path: `${SPACES_PATH}/:id/restore`, auth: true, handler: restoreSpace },
  { method: 'GET', path: LIBRARY_TRASH_PATH, auth: true, handler: listLibraryTrash },
  { method: 'POST', path: LIBRARY_BATCH_PATH, auth: true, handler: batchLibrary },
  { method: 'POST', path: LIBRARY_EMPTY_PATH, auth: true, handler: emptyLibrary },
  { method: 'POST', path: NOTES_BATCH_PATH, auth: true, handler: batchNotes },
  { method: 'POST', path: NOTES_EMPTY_PATH, auth: true, handler: emptyNotes },
  { method: 'GET', path: SUBSCRIPTIONS_PATH, auth: true, handler: listSubscriptions },
  { method: 'GET', path: `${SUBSCRIPTIONS_PATH}/:id`, auth: true, handler: getSubscription },
  { method: 'PUT', path: `${SUBSCRIPTIONS_PATH}/:id`, auth: true, handler: updateSubscription },
  { method: 'POST', path: `${SUBSCRIPTIONS_PATH}/:id/rules`, auth: true, handler: adoptSubscriptionRule },
  { method: 'POST', path: `${SUBSCRIPTIONS_PATH}/:id/run`, auth: true, handler: runSubscriptionNow },
  { method: 'GET', path: REVIEW_PATH, auth: true, handler: getReviewSummary },
  { method: 'GET', path: MEMORY_DOCS_PATH, auth: true, handler: getMemoryDocDirectory },
  { method: 'GET', path: `${MEMORY_DOCS_PATH}/:id`, auth: true, handler: getMemoryDoc },
  { method: 'PUT', path: `${MEMORY_DOCS_PATH}/:docId/lines/:lineId`, auth: true, handler: editMemoryLine },
  { method: 'POST', path: `${MEMORY_DOCS_PATH}/:docId/lines/:lineId/retire`, auth: true, handler: retireMemoryLine },
  { method: 'GET', path: MEMORY_INFERENCES_PATH, auth: true, handler: listMemoryInferences },
  { method: 'POST', path: `${MEMORY_INFERENCES_PATH}/:id/confirm`, auth: true, handler: confirmMemoryInference },
  { method: 'POST', path: `${MEMORY_INFERENCES_PATH}/:id/reject`, auth: true, handler: rejectMemoryInference },
  { method: 'GET', path: PROJECTS_PATH, auth: true, handler: listProjects },
  { method: 'POST', path: PROJECTS_PATH, auth: true, handler: createProject },
  { method: 'GET', path: `${PROJECTS_PATH}/:id`, auth: true, handler: getProject },
  { method: 'PUT', path: `${PROJECTS_PATH}/:id`, auth: true, handler: editProject },
  { method: 'POST', path: `${PROJECTS_PATH}/:id/health`, auth: true, handler: setProjectHealth },
  { method: 'POST', path: `${PROJECTS_PATH}/:id/items`, auth: true, handler: fileProjectItem },
  { method: 'POST', path: `${PROJECTS_PATH}/:id/items/remove`, auth: true, handler: unfileProjectItem },
  { method: 'POST', path: `${PROJECTS_PATH}/:id/todos`, auth: true, handler: addProjectTodo },
  { method: 'PUT', path: `${PROJECTS_PATH}/:id/todos/:todoId`, auth: true, handler: editProjectTodo },
  { method: 'GET', path: BOOKMARKS_PATH, auth: true, handler: listBookmarks },
  { method: 'POST', path: BOOKMARKS_PATH, auth: true, handler: addBookmark },
  { method: 'POST', path: BOOKMARKS_ORDER_PATH, auth: true, handler: orderBookmarks },
  { method: 'POST', path: BOOKMARKS_IMPORT_PATH, auth: true, handler: importBookmarks },
  { method: 'PUT', path: `${BOOKMARKS_PATH}/:id`, auth: true, handler: editBookmark },
  { method: 'POST', path: `${BOOKMARKS_PATH}/:id/remove`, auth: true, handler: removeBookmark },
  { method: 'POST', path: `${BOOKMARKS_PATH}/:id/restore`, auth: true, handler: restoreBookmark },
  { method: 'GET', path: WEB_TABS_PATH, auth: true, handler: getWebTabs },
  { method: 'PUT', path: WEB_TABS_PATH, auth: true, handler: putWebTabs },
  { method: 'POST', path: WEB_TABS_MERGE_PATH, auth: true, handler: mergeWebTabs },
  { method: 'GET', path: FAVICON_PATH, auth: true, handler: getFavicon },
  { method: 'PUT', path: FAVICON_PATH, auth: true, handler: putFavicon },
  { method: 'GET', path: TODAY_SETTINGS_PATH, auth: true, handler: getDailySettings },
  { method: 'PUT', path: TODAY_SETTINGS_PATH, auth: true, handler: updateDailySettings },
  { method: 'GET', path: FEED_PATH, auth: true, handler: listFeed },
  { method: 'GET', path: FEED_NAV_PATH, auth: true, handler: feedNav },
  { method: 'POST', path: FEED_REFRESH_PATH, auth: true, handler: refreshFeed },
  { method: 'GET', path: `${FEED_REFRESH_PATH}/:requestId`, auth: true, handler: getFeedRefresh },
  { method: 'POST', path: FEED_ITEMS_PATH, auth: true, handler: addFeedItem },
  { method: 'GET', path: `${FEED_ITEMS_PATH}/:id`, auth: true, handler: getFeedItem },
  { method: 'POST', path: `${FEED_ITEMS_PATH}/:id/reaction`, auth: true, handler: reactFeedItem },
  { method: 'POST', path: `${FEED_ITEMS_PATH}/:id/save`, auth: true, handler: saveFeedItem },
  { method: 'GET', path: `${FEED_ITEMS_PATH}/:id/comments`, auth: true, handler: listFeedComments },
  { method: 'POST', path: `${FEED_ITEMS_PATH}/:id/comments`, auth: true, handler: addFeedComment },
  { method: 'POST', path: `${FEED_ITEMS_PATH}/:id/comments/:commentId/retry`, auth: true, handler: retryFeedComment },
  { method: 'POST', path: `${FEED_SOURCES_PATH}/blocked`, auth: true, handler: blockFeedSite },
  { method: 'GET', path: FEED_SOURCES_PATH, auth: true, handler: listFeedSources },
  { method: 'GET', path: FEED_REDDIT_PREVIEW_PATH, auth: true, handler: previewReddit },
  { method: 'POST', path: FEED_REDDIT_PATH, auth: true, handler: addReddit },
  { method: 'POST', path: `${FEED_SOURCES_PATH}/:id/settings`, auth: true, handler: updateFeedSource },
  { method: 'POST', path: `${FEED_SOURCES_PATH}/:id/refresh`, auth: true, handler: refreshFeedSource },
  { method: 'POST', path: `${FEED_SOURCES_PATH}/:id/delete`, auth: true, handler: deleteFeedSource },
  { method: 'POST', path: FEED_SOURCES_PATH, auth: true, handler: addInterest },
  { method: 'POST', path: `${FEED_SOURCES_PATH}/subscriptions`, auth: true, handler: addSubscription },
  { method: 'POST', path: `${FEED_SOURCES_PATH}/:id/level`, auth: true, handler: setSourceLevel },
  { method: 'POST', path: `${FEED_SOURCES_PATH}/:id/query`, auth: true, handler: setSourceQuery },
  { method: 'GET', path: NODES_PATH, auth: true, handler: listNodes },
  { method: 'GET', path: NODE_ACTIONS_PATH, auth: true, handler: listNodeActions },
  { method: 'GET', path: NODE_NEXT_ACTION_PATH, auth: false, node: true, longPoll: true, handler: nextNodeAction },
  { method: 'POST', path: `${NODE_ACTIONS_PATH}/:id/result`, auth: false, node: true, handler: reportNodeAction },
  { method: 'POST', path: NODE_PAIRING_CODES_PATH, auth: true, handler: issueNodePairingCode },
  { method: 'POST', path: `${NODES_PATH}/:id/revoke`, auth: true, handler: revokeNodeHandler },
  { method: 'POST', path: `${NODES_PATH}/:id/limits`, auth: true, handler: setNodeLimitsHandler },
  { method: 'POST', path: NODE_PAIR_PATH, auth: false, handler: pairNodeHandler },
  { method: 'POST', path: NODE_HELLO_PATH, auth: false, node: true, handler: helloNodeHandler },
  { method: 'POST', path: NODE_LOGS_PATH, auth: false, node: true, handler: nodeLogsHandler },
  { method: 'POST', path: NODE_BROWSER_SESSION_PATH, auth: false, node: true, handler: nodeBrowserSession },
  { method: 'GET', path: FEED_X_PATH, auth: false, node: true, handler: getXTimelineDue },
  { method: 'POST', path: FEED_X_PATH, auth: false, node: true, handler: reportXTimeline },
  { method: 'GET', path: FEED_XHS_PATH, auth: false, node: true, handler: getXhsDue },
  { method: 'POST', path: FEED_XHS_PATH, auth: false, node: true, handler: reportXhs },
  { method: 'GET', path: FEED_COMPUTER_FETCH_PATH, auth: false, node: true, handler: leaseComputerFetches },
  { method: 'POST', path: FEED_COMPUTER_FETCH_PATH, auth: false, node: true, handler: reportComputerFetch },
  { method: 'GET', path: DOUYIN_PATH, auth: true, handler: listDouyin },
  { method: 'POST', path: DOUYIN_SYNC_PATH, auth: true, handler: syncDouyin },
  { method: 'POST', path: DOUYIN_PROCESS_PATH, auth: true, handler: processDouyin },
  { method: 'GET', path: DOUYIN_NODE_PATH, auth: false, node: true, handler: douyinJobs },
  { method: 'POST', path: DOUYIN_NODE_PATH, auth: false, node: true, handler: reportDouyin },
  { method: 'GET', path: TRANSCRIBER_PATH, auth: true, handler: getTranscriber },
  { method: 'POST', path: TRANSCRIBER_INSTALL_PATH, auth: true, handler: installTranscriber },
  { method: 'GET', path: MONEY_PATH, auth: true, handler: getMoney },
  { method: 'GET', path: MONEY_STATS_PATH, auth: true, handler: getMoneyStats },
  { method: 'POST', path: MONEY_ENTRIES_PATH, auth: true, handler: recordMoney },
  { method: 'PUT', path: `${MONEY_ENTRIES_PATH}/:id`, auth: true, handler: editMoney },
  { method: 'POST', path: `${MONEY_ENTRIES_PATH}/:id/remove`, auth: true, handler: removeMoney },
  { method: 'POST', path: MONEY_ACCOUNTS_PATH, auth: true, handler: addMoneyAccount },
  { method: 'PUT', path: `${MONEY_ACCOUNTS_PATH}/:id`, auth: true, handler: editMoneyAccount },
  { method: 'GET', path: INBOX_PATH, auth: true, handler: listInbox },
  { method: 'POST', path: `${INBOX_PATH}/sync`, auth: true, handler: syncInbox },
  { method: 'POST', path: `${INBOX_PATH}/feedback`, auth: true, handler: addInboxFeedback },
  { method: 'POST', path: INBOX_READ_ALL_PATH, auth: true, handler: readAllInbox },
  { method: 'POST', path: `${INBOX_REPLIES_PATH}/:id/settle`, auth: true, handler: settleInboxReply },
  { method: 'GET', path: `${INBOX_PATH}/:id`, auth: true, handler: getInboxMessage },
  { method: 'POST', path: `${INBOX_PATH}/:id/flags`, auth: true, handler: setInboxFlags },
  { method: 'POST', path: `${INBOX_PATH}/:id/replies`, auth: true, handler: replyInbox },
  { method: 'GET', path: TOOL_GROUPS_PATH, auth: true, handler: listToolGroups },
  { method: 'POST', path: `${TOOL_GROUPS_PATH}/:id`, auth: true, handler: setToolGroup },
  { method: 'GET', path: FILES_PATH, auth: true, handler: listFiles },
  { method: 'GET', path: FILES_CONTENT_PATH, auth: true, handler: downloadFile },
  { method: 'POST', path: FILES_UPLOAD_PATH, auth: true, handler: uploadFile },
  { method: 'POST', path: FILES_FOLDERS_PATH, auth: true, handler: createFolder },
  { method: 'POST', path: FILES_MOVE_PATH, auth: true, handler: moveFile },
  { method: 'GET', path: FILES_TRASH_PATH, auth: true, handler: listTrash },
  { method: 'POST', path: FILES_TRASH_PATH, auth: true, handler: trashFile },
  { method: 'POST', path: FILES_RESTORE_PATH, auth: true, handler: restoreFile },
  { method: 'POST', path: FILES_TABLE_PATH, auth: true, handler: exportTable },
  { method: 'GET', path: BROWSER_STREAM_PATH, auth: true, handler: streamBrowser },
  { method: 'POST', path: BROWSER_ACK_PATH, auth: true, handler: ackBrowser },
  { method: 'POST', path: BROWSER_TABS_PATH, auth: true, handler: tabBrowser },
  { method: 'GET', path: BROWSER_PATH, auth: true, handler: getBrowser },
  { method: 'GET', path: BROWSER_FRAME_PATH, auth: true, handler: getBrowserFrame },
  { method: 'POST', path: BROWSER_OPEN_PATH, auth: true, handler: openBrowser },
  { method: 'POST', path: BROWSER_ACTIONS_PATH, auth: true, handler: actBrowser },
  { method: 'POST', path: `${ACTIONS_PATH}/:requestId/settle`, auth: true, handler: settleAction },
];

export type RouteMatch =
  | { kind: 'found'; route: Route; params: Record<string, string> }
  | { kind: 'wrong_method'; allowed: HttpMethod[] }
  | { kind: 'none' };

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ApiError(400, 'invalid_request', '路径里有不能解码的部分。', {
      next: '地址编码有误，请刷新后重试。',
    });
  }
}

function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const want = pattern.split('/');
  const got = path.split('/');
  if (want.length !== got.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (const [index, part] of want.entries()) {
    const actual = got[index] ?? '';
    if (part.startsWith(':')) {
      if (actual === '') {
        return undefined;
      }
      params[part.slice(1)] = decodeSegment(actual);
    } else if (part !== actual) {
      return undefined;
    }
  }
  return params;
}

export function matchRoute(method: string, path: string, routes: readonly Route[] = ROUTES): RouteMatch {
  const allowed: HttpMethod[] = [];
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params === undefined) {
      continue;
    }
    if (route.method === method) {
      return { kind: 'found', route, params };
    }
    allowed.push(route.method);
  }
  return allowed.length === 0 ? { kind: 'none' } : { kind: 'wrong_method', allowed };
}
