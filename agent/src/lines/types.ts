import type { AgentTool, AgentToolResult, StreamFn, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, AssistantMessage, Context, Model } from '@earendil-works/pi-ai';
import { HARD_LINES } from '../../shared/act-or-ask.ts';
import type { LineKind } from '../../shared/api/lines.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';
import type { OutboundResult, OutboundSpec } from '../../shared/outbound.ts';

export const HARD_LINE_KINDS = ['spend', 'outward', 'irreversible', 'permission', 'in_person'] as const;
export type HardLineKind = (typeof HARD_LINE_KINDS)[number];

export const HARD_LINE_LABELS: Readonly<Record<HardLineKind, string>> = {
  spend: HARD_LINES[0],
  outward: HARD_LINES[1],
  irreversible: HARD_LINES[2],
  permission: HARD_LINES[3],
  in_person: HARD_LINES[4],
};

export interface LineScope {
  actorId?: string;
  lineId: string;
  kind: LineKind;
  projectId: string | null;
}

export type ToolArgs = Record<string, unknown>;

export interface KernelTool {
  name: string;
  say(args: ToolArgs): string;
  hardLine(args: ToolArgs): HardLineKind | null;
  outbound?(args: ToolArgs): OutboundSpec | null;
  outboundResult?(result: AgentToolResult<unknown>, isError: boolean): OutboundResult;
  consequence?(args: ToolArgs): string;
  approveLabel?(args: ToolArgs): string;
  preview?(args: ToolArgs): Record<string, unknown> | null;
  enabled?(): boolean;
  lineKinds?: readonly LineKind[];
  create(scope: LineScope): AgentTool;
}

export interface CompleteOptions {
  signal?: AbortSignal;
  reasoning?: ThinkingLevel;
  maxTokens?: number;
  usage?: UsageTag;
}

export interface UsageTag {
  purpose: string;
  lineId?: string | null;
}

export interface ModelChoice {
  model: Model<Api>;
  thinking: ThinkingLevel;
}

export interface ModelSource {
  current(purpose?: ModelPurpose): ModelChoice | undefined;
  streamFn: StreamFn;
  complete(model: Model<Api>, context: Context, options?: CompleteOptions): Promise<AssistantMessage>;
}

export type Later = (ms: number, run: () => void) => () => void;

export const realLater: Later = (ms, run) => {
  const timer = setTimeout(run, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

export function sleepFor(later: Later, ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve(false);
      return;
    }
    const aborted = (): void => {
      cancel();
      resolve(false);
    };
    const cancel = later(ms, () => {
      signal?.removeEventListener('abort', aborted);
      resolve(true);
    });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}
