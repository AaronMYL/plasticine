import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Value } from 'typebox/value';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { ModelImage } from '../../shared/model.ts';
import { ToolFailure, type PermissionGate, type Tool, type ToolContext } from '../tools/index.ts';
import { failureText } from '../util/index.ts';
import type { HardLineKind, KernelTool, LineScope, ToolArgs } from './types.ts';

export interface LegacyMeta {
  say(args: ToolArgs): string;
  hardLine?(args: ToolArgs): HardLineKind | null;
  consequence?(args: ToolArgs): string;
  details?(actionId: string): unknown;
}

export interface LegacyOptions {
  dryRun: boolean;
  now: () => Date;
  permission?: PermissionGate;
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

function failure(error: unknown): Error {
  if (error instanceof ToolFailure) {
    return new Error(error.content);
  }
  return new Error(failureText(error));
}

function argsProblem(tool: Tool, params: unknown): string {
  const first = Value.Errors(tool.parameters, params)[0];
  const where = first === undefined ? '' : `（${first.instancePath || '/'} ${first.message}）`;
  const hint = tool.argsHint?.(params) ?? null;
  return `「${tool.name}」的参数不合要求${where}，这次没有执行。${hint === null ? '' : hint}`;
}

function legacyAgentTool(tool: Tool, meta: LegacyMeta, scope: LineScope, options: LegacyOptions): AgentTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.declared ?? tool.parameters,
    ...(tool.replay === 'safe' ? { replay: 'safe' as const } : {}),
    ...(tool.parallel ? {} : { executionMode: 'sequential' as const }),
    async execute(toolCallId, params, signal) {
      if (options.enabled?.(tool.name) === false) {
        throw new Error('这件工具已关闭。打开对应工具组后才能使用。');
      }
      if (tool.declared !== undefined && !Value.Check(tool.parameters, params)) {
        throw new Error(argsProblem(tool, params));
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

export function adaptLegacyTool(tool: Tool, meta: LegacyMeta, options: LegacyOptions): KernelTool {
  return {
    name: tool.name,
    say: meta.say,
    hardLine: meta.hardLine ?? (() => null),
    ...(tool.outbound === undefined ? {} : { outbound: (args: ToolArgs) => tool.outbound!(args) }),
    ...(meta.consequence === undefined ? {} : { consequence: meta.consequence }),
    ...(options.enabled === undefined ? {} : { enabled: () => options.enabled?.(tool.name) ?? true }),
    create: (scope) => legacyAgentTool(tool, meta, scope, options),
  };
}
