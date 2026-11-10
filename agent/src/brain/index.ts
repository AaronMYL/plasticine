// brain/：留给新内核的业务工具（每个工具一个文件，参数 schema 来自 shared/）和几处旁路的模型活（笔记 AI、网页翻译、
// 信息流选材与评论、图书大纲、记账截图、分身答话、记忆整理）。2026-11-05 Harness 重做：对话轮、任务轮、验收、诊断、
// 回执审查和它们的上下文装配都删了，线的循环在 lines/，模型在 kernel/（旁路调用经 kernel/text.ts）。

export { BYTES_PER_TOKEN, estimateTokens } from './tokens.ts';
export { createServerCommandTools } from './tools/server-command.ts';
export { createSkillTools, skillScope } from './tools/skills.ts';
export { ensureDefaultProjects } from './default-projects.ts';
export { autoOnlyPermissionGate } from './tools/permission.ts';
export type { PermissionDecision, PermissionGate, PermissionRequest } from './tools/permission.ts';
export {
  createDeviceActionGate,
  createDeviceActionTool,
  DEVICE_ACTION_TOOL,
  DeviceActionParameters,
} from './tools/device-action.ts';
export type { DeviceActionPort } from './tools/device-action.ts';
export { createDeviceNodesTool } from './tools/device-nodes.ts';
export { getTimeTool } from './tools/get-time.ts';
export { askJson } from './book-model.ts';
export type { BookModel } from './book-model.ts';
export { PaymentReader } from './payment-reader.ts';
export { createPaymentTool } from './tools/payment.ts';
export { projectOverview, projectTools } from './tools/projects.ts';
// 记忆文档（用户 2026-11-02 定）：后台整理、读工具、上下文一段，和记忆页要用的几种写法。
export { MAX_ATTEMPTS as MEMORY_MAX_ATTEMPTS, MemoryCurator } from './memory-curator.ts';
export { createMemoryDocTools } from './tools/memory-docs.ts';
export { directoryDocs, findDoc, memoryDocsSection, rulesDocSection, searchMemory, todaySection }
  from './memory-docs-context.ts';
export { forgetMemory, journalDay } from './memory-journal.ts';
export { canUndoChange, chooseDreamCandidate, DreamActionError, undoDreamChange } from './memory-dream-actions.ts';
export {
  addLine,
  decideInference,
  docEvent,
  docFullness,
  ensureMemoryDocs,
  ensureRulesDoc,
  mergeAnchors,
  moveInference,
  proposeInference,
  retireLine,
  reviseLine,
  withdrawInference,
} from './memory-doc-writes.ts';
export type { Writer } from './memory-doc-writes.ts';
export { looksLikeSecret, sameThing } from './memory-curation-ops.ts';
export { defineTool, ToolRegistry } from './tools/registry.ts';
export type { Tool, ToolContext, ToolGate, ToolSpec } from './tools/registry.ts';
// 新内核（lines/）的「记住一句」复用同一条记法，来源换成线里他说的话。
export { RememberParameters, rememberWithSources } from './tools/memory-remember.ts';
export type { RememberArgs } from './tools/memory-remember.ts';
export type { CurationState } from './memory-curation-work.ts';
export type { CurationSource } from './memory-curation-ops.ts';
export { createShowWidgetsTool } from './tools/show-widgets.ts';
export type { WidgetFacts, WidgetRecorder } from './tools/show-widgets.ts';
export { createAttachmentTextTool } from './tools/attachment-text.ts';
export type { AttachmentReader } from './tools/attachment-text.ts';
export { BrowserActionSchema, createCloudBrowserActTool } from './tools/cloud-browser-act.ts';
export type { BrowserActor } from './tools/cloud-browser-act.ts';
export { createCloudBrowserOpenTool } from './tools/cloud-browser-open.ts';
export type { BrowserOpener } from './tools/cloud-browser-open.ts';
export { createCloudBrowserReadTool } from './tools/cloud-browser-read.ts';
export type { BrowserReader } from './tools/cloud-browser-read.ts';
export { createCloudBrowserObserveTool } from './tools/cloud-browser-observe.ts';
export type { BrowserObserver } from './tools/cloud-browser-observe.ts';
export { createCloudSshRunTool } from './tools/cloud-ssh-run.ts';
export type { SshRunner } from './tools/cloud-ssh-run.ts';
export { createListInboxTool, INBOX_TOOL_BOXES } from './tools/list-inbox.ts';
export type { InboxLister } from './tools/list-inbox.ts';
export { createReadInboxTool } from './tools/read-inbox.ts';
export type { InboxReader } from './tools/read-inbox.ts';
export { createFeedSelector } from './feed-selection.ts';
export { NoteAssistant } from './note-assistant.ts';
export { PageTranslator, TRANSLATE_CONCURRENCY } from './page-translator.ts';
export type { GlossaryTerm, PageTranslateInput, PageTranslatorDeps } from './page-translator.ts';
export { createNoteTools } from './tools/notes.ts';
export { createBookTools } from './tools/books.ts';
export { BookInsightService, anchorQuote } from './book-insights.ts';
export type { BookInsightDeps } from './book-insights.ts';
export { createFeedCommentGenerator } from './feed-comments.ts';
export { createFeedTranslator, stripFence } from './feed-translator.ts';
export { ToolFailure, ToolUncertain } from './tools/failure.ts';
// 做梦：每晚整理记忆（《优化清单》第 10 条夜里那一半）。
export { Dreamer, DreamOutputSchema } from './memory-dream.ts';
export type { DreamInput, DreamReport, DreamSkills, DreamState } from './memory-dream.ts';

export { publishBookSpace, backfillBookSpaces, bookSpaceSource } from './book-spaces.ts';
export { extractWebPage, prepareWebArchive, publishWebArchive, assertWebArchiveDestination, WebExtractError } from './web-extract.ts';
