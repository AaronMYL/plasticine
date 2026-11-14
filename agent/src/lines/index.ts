// lines/：新内核（2026-11-05 他定：Harness 推倒重做）。用 pi-agent-core 的 Agent 跑「线」：主对话一条 main 线，
// 要花时间的事开后台线；排队、立即发送、叫停；硬线工具先问他；失败重试、额度暂停、重启续跑。
// 外面只经这里：app/ 拿 LineKernel 挂接口，assemble 把业务工具包成 KernelTool 交进来。

export { LineKernel } from './kernel.ts';
export { LineError, MAX_BACKGROUND_LINES } from './kernel-types.ts';
export type { After, Compactor, KernelOptions, KernelState, LineErrorCode, OpenLine, SendInput, SendResult }
  from './kernel-types.ts';
export { HARD_LINE_KINDS, HARD_LINE_LABELS, realLater } from './types.ts';
export type { CompleteOptions, HardLineKind, KernelTool, Later, LineScope, ModelChoice, ModelSource, ToolArgs }
  from './types.ts';
export { DEFAULT_PAUSE_MS, RETRY_DELAYS_MS, classifyFailure, resetTime } from './failure.ts';
export { NO_MODEL_REASON } from './runner.ts';
export type { DriveOutcome } from './runner.ts';
export { checkedArgs } from './tool-args.ts';
export { convertToLlm, contentText } from './messages.ts';
export type { LineReportMessage, LineSummaryMessage } from './messages.ts';
export { adaptLegacyTool } from './legacy.ts';
export type { LegacyMeta, LegacyOptions } from './legacy.ts';
export { legacySayings, legacyToolNames } from './catalog.ts';
export type { NodeLabel } from './catalog.ts';
export { serverCommandTool } from './server-tool.ts';
export { answerSentence, awaitAnswer, QUESTION_PURPOSE } from './ask-tools.ts';
export type { AskToolHost } from './ask-tools.ts';
export { rememberTool } from './remember-tool.ts';
export { conversationSearchTool } from './search-tool.ts';
export { forgetTool } from './forget-tool.ts';
export { attachmentReadTool } from './attachment-read-tool.ts';
export type { SubmitHoldPort } from './page-submit-tool.ts';
export { COMPACTION_KEEP_RECENT_TOKENS, COMPACTION_RESERVE_TOKENS, contextTokens, createCompactor, findCut,
  serializeForSummary } from './compaction.ts';
export { MAX_DAY_COMPACTIONS, contextWindow, localDay, rollDay, segmented } from './day-context.ts';
export { LARGE_RESULT_CHARS, READ_RESULT_TOOL } from './large-results.ts';
export { OPEN_SIDE_TOOL, titleFromText } from './side-chats.ts';
