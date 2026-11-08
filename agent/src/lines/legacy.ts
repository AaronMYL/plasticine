// 第三级：把留下来的旧工具包成新内核的工具，执行逻辑原样复用（不重写业务）。旧工具是 execute(args, ToolContext) →
// 一段文字；这里给它一个线上的上下文（runId = line:<线>，动作标识 = 这条线 + 这次调用），把文字和图换成 pi 的结果。
// 旧调度器里还要的几样也在这里做：开发期干跑（对外的动作只记不做）、设备动作的权限门（设备上限、逐次确认卡）、
// 结果太长截短。工具组开关（他关掉的组）由 enabled 决定，关掉的工具这条线看不到。

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { ModelImage } from '../../shared/model.ts';
import { ToolFailure, type PermissionGate, type Tool, type ToolContext } from '../brain/index.ts';
import { failureText } from '../shared-log.ts';
import type { HardLineKind, KernelTool, LineScope, ToolArgs } from './types.ts';

/** 每件留下来的旧工具在新内核里怎么说自己（大白话）、属不属于硬线。 */
export interface LegacyMeta {
  say(args: ToolArgs): string;
  hardLine?(args: ToolArgs): HardLineKind | null;
  consequence?(args: ToolArgs): string;
  /** 这次调用除了文字还要交给界面的东西（卡片小部件）：按动作标识取。 */
  details?(actionId: string): unknown;
}

export interface LegacyOptions {
  /** 开发期干跑（10-26 第 8 条）：对外的动作只记一句，不真的做。 */
  dryRun: boolean;
  now: () => Date;
  /** 旧调度器的权限门（设备动作的上限、逐次确认）；其余工具直接放行。 */
  permission?: PermissionGate;
  /** 工具组开关（旧注册表的 gate）：关掉的工具线上看不到。 */
  enabled?: (name: string) => boolean;
}

function argsRecord(params: unknown): Record<string, unknown> {
  return typeof params === 'object' && params !== null && !Array.isArray(params)
    ? params as Record<string, unknown> : {};
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) {
    return text;
  }
  return `${chars.slice(0, max).join('')}\n\n[结果共 ${chars.length} 字，超过上限 ${max} 字，这里只保留前 ${max} 字。]`;
}

/** 旧工具报的错：业务失败（ToolFailure）把它写给模型的那句原样交回；其余带上原因。 */
function failure(error: unknown): Error {
  if (error instanceof ToolFailure) {
    return new Error(error.content);
  }
  return new Error(failureText(error));
}

function legacyAgentTool(tool: Tool, meta: LegacyMeta, scope: LineScope, options: LegacyOptions): AgentTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    // 只读、可重放的旧工具重启后可以安全重做；其余（once）结果不明时如实说，不重做。
    ...(tool.replay === 'safe' ? { replay: 'safe' as const } : {}),
    ...(tool.parallel ? {} : { executionMode: 'sequential' as const }),
    async execute(toolCallId, params, signal) {
      if (options.enabled?.(tool.name) === false) {
        throw new Error('这件工具已关闭。打开对应工具组后才能使用。');
      }
      const args = argsRecord(params);
      const runId = `line:${scope.lineId}`;
      const actionId = `${runId}:${toolCallId}`;
      const abort = signal ?? new AbortController().signal;
      if (options.permission !== undefined) {
        const decision = await options.permission.check({ tool, args, runId, signal: abort, actionId });
        if (!decision.allowed) {
          throw new Error(decision.message);
        }
      }
      if (options.enabled?.(tool.name) === false) {
        throw new Error('这件工具已关闭。打开对应工具组后才能使用。');
      }
      if (options.dryRun && tool.effect === 'external') {
        return { content: [{ type: 'text', text: `干跑：开发期外部动作不真的执行。「${tool.label}」已记录，没有发出。` }],
          details: { dryRun: true } };
      }
      const images: ModelImage[] = [];
      const context: ToolContext = { signal: abort, runId, callId: toolCallId, actionId, now: options.now,
        emitImage: (image) => images.push(image) };
      let text: string;
      try {
        text = await tool.execute(args, context);
      } catch (error) {
        throw failure(error);
      }
      const content: (TextContent | ImageContent)[] = [{ type: 'text', text: truncate(text, tool.maxResultChars) }];
      for (const image of images) {
        content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
      }
      const result: AgentToolResult<unknown> = { content, details: meta.details?.(actionId) ?? {} };
      return result;
    },
  };
}

/** 一件旧工具 → 新内核的工具。 */
export function adaptLegacyTool(tool: Tool, meta: LegacyMeta, options: LegacyOptions): KernelTool {
  return {
    name: tool.name,
    say: meta.say,
    hardLine: meta.hardLine ?? (() => null),
    ...(meta.consequence === undefined ? {} : { consequence: meta.consequence }),
    ...(options.enabled === undefined ? {} : { enabled: () => options.enabled?.(tool.name) ?? true }),
    create: (scope) => legacyAgentTool(tool, meta, scope, options),
  };
}
