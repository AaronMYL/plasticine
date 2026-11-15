export { changeSoul, soulView } from '../memory/rules/soul.ts';
export { adoptMateSoul, adoptMateSouls } from '../mates/mate-rules.ts';
// brain/：留给新内核的业务工具（每个工具一个文件，参数 schema 来自 shared/）和几处旁路的模型活（笔记 AI、网页翻译、
// 信息流选材与评论、图书大纲、记账截图、分身答话、记忆整理）。2026-11-05 Harness 重做：对话轮、任务轮、验收、诊断、
// 回执审查和它们的上下文装配都删了，线的循环在 lines/，模型在 kernel/（旁路调用经 kernel/text.ts）。

export { BYTES_PER_TOKEN, estimateTokens } from './tokens.ts';
export { createServerCommandTools } from '../cloud-tools/server-command-tool.ts';
export { createSkillTools, skillScope } from '../skills/tools.ts';
export { ensureDefaultProjects } from '../projects/default-projects.ts';
export { autoOnlyPermissionGate } from './permission.ts';
export type { PermissionDecision, PermissionGate, PermissionRequest } from './permission.ts';
export {
  createDeviceActionGate,
  createDeviceActionTool,
  DEVICE_ACTION_TOOL,
  DeviceActionParameters,
} from '../devices/device-action.ts';
export type { DeviceActionPort } from '../devices/device-action.ts';
export { createDeviceNodesTool } from '../devices/device-nodes.ts';
export { getTimeTool } from './get-time.ts';
export { askJson } from '../books/book-model.ts';
export type { BookModel } from '../books/book-model.ts';
export { PaymentReader } from '../life/payment-reader.ts';
export { createPaymentTool } from '../life/payment-tool.ts';
export { projectOverview, projectTools } from '../projects/tools.ts';
// 记忆文档（用户 2026-11-02 定）：后台整理、读工具、上下文一段，和记忆页要用的几种写法。
export { MAX_ATTEMPTS as MEMORY_MAX_ATTEMPTS, MemoryCurator } from '../memory/curation/memory-curator.ts';
export { createMemoryDocTools } from '../memory/docs/tools-docs.ts';
export { directoryDocs, findDoc, memoryDocsSection, rulesDocSection, searchMemory, todaySection }
  from '../memory/docs/memory-docs-context.ts';
export { forgetMemory, journalDay } from '../memory/journal/memory-journal.ts';
export { canUndoChange, chooseDreamCandidate, DreamActionError, undoDreamChange } from '../memory/dream/memory-dream-actions.ts';
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
} from '../memory/docs/memory-doc-writes.ts';
export type { Writer } from '../memory/docs/memory-doc-writes.ts';
export { looksLikeSecret, sameThing } from '../memory/curation/memory-curation-ops.ts';
export { defineTool, ToolRegistry } from './registry.ts';
export type { Tool, ToolContext, ToolGate, ToolSpec } from './registry.ts';
// 新内核（lines/）的「记住一句」复用同一条记法，来源换成线里他说的话。
export { RememberParameters, rememberWithSources } from '../memory/docs/tools-remember.ts';
export type { RememberArgs } from '../memory/docs/tools-remember.ts';
export type { CurationState } from '../memory/curation/memory-curation-work.ts';
export type { CurationSource } from '../memory/curation/memory-curation-ops.ts';
export { createShowWidgetsTool } from './show-widgets.ts';
export type { WidgetFacts, WidgetRecorder } from './show-widgets.ts';
export { createAttachmentTextTool } from './attachment-text.ts';
export type { AttachmentReader } from './attachment-text.ts';
export { BrowserActionSchema, createCloudBrowserActTool } from '../cloud-tools/cloud-browser-act.ts';
export type { BrowserActor } from '../cloud-tools/cloud-browser-act.ts';
export { createCloudBrowserOpenTool } from '../cloud-tools/cloud-browser-open.ts';
export type { BrowserOpener } from '../cloud-tools/cloud-browser-open.ts';
export { createCloudBrowserReadTool } from '../cloud-tools/cloud-browser-read.ts';
export type { BrowserReader } from '../cloud-tools/cloud-browser-read.ts';
export { createCloudBrowserObserveTool } from '../cloud-tools/cloud-browser-observe.ts';
export type { BrowserObserver } from '../cloud-tools/cloud-browser-observe.ts';
export { createCloudSshRunTool } from '../cloud-tools/cloud-ssh-run.ts';
export type { SshRunner } from '../cloud-tools/cloud-ssh-run.ts';
export { createListInboxTool, INBOX_TOOL_BOXES } from '../intake/list-inbox-tool.ts';
export type { InboxLister } from '../intake/list-inbox-tool.ts';
export { createReadInboxTool } from '../intake/read-inbox-tool.ts';
export type { InboxReader } from '../intake/read-inbox-tool.ts';
export { createFeedSelector } from '../daily/feed-selection.ts';
export { NoteAssistant } from '../notes/note-assistant.ts';
export { ComposePredictor, type ComposeContext, type ComposeTurn } from '../loop/compose-predictor.ts';
export { PageTranslator, TRANSLATE_CONCURRENCY } from '../web/page-translator.ts';
export type { GlossaryTerm, PageTranslateInput, PageTranslatorDeps } from '../web/page-translator.ts';
export { createNoteTools } from '../notes/tools.ts';
export { createBookTools } from '../books/tools.ts';
export { BookInsightService, anchorQuote } from '../books/book-insights.ts';
export type { BookInsightDeps } from '../books/book-insights.ts';
export { createFeedCommentGenerator } from '../daily/feed-comment-generator.ts';
export { createFeedTranslator, stripFence } from '../daily/feed-translator.ts';
export { ToolFailure, ToolUncertain } from './failure.ts';
// 做梦：每晚整理记忆（《优化清单》第 10 条夜里那一半）。
export { Dreamer, DreamOutputSchema } from '../memory/dream/memory-dream.ts';
export type { DreamInput, DreamReport, DreamSkills, DreamState, DreamSuggest } from '../memory/dream/memory-dream.ts';

export { publishBookSpace, backfillBookSpaces, bookSpaceSource, refreshBookOutlineMarks } from '../books/book-spaces.ts';
export { extractWebPage, prepareWebArchive, publishWebArchive, assertWebArchiveDestination, WebExtractError }
  from '../web/web-extract.ts';
