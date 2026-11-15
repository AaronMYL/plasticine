// tools/：给内核的工具怎么登记（registry）、出错怎么说（failure）、要不要先问（permission），和几个不属于任何业务的通用工具
// （看时间、展示小部件、读附件文字）；另有全站共用的 token 估算。各业务自己的工具在各自的业务包里（books/tools.ts、
// notes/tools.ts、memory/docs/tools-docs.ts……），不放这里。

export { BYTES_PER_TOKEN, estimateTokens } from './tokens.ts';
export { autoOnlyPermissionGate } from './permission.ts';
export type { PermissionDecision, PermissionGate, PermissionRequest } from './permission.ts';
export { getTimeTool } from './get-time.ts';
export { defineTool, ToolRegistry } from './registry.ts';
export type { Tool, ToolContext, ToolGate, ToolSpec } from './registry.ts';
export { createShowWidgetsTool } from './show-widgets.ts';
export type { WidgetFacts, WidgetRecorder } from './show-widgets.ts';
export { createAttachmentTextTool } from './attachment-text.ts';
export type { AttachmentReader } from './attachment-text.ts';
export { ToolFailure, ToolUncertain } from './failure.ts';
