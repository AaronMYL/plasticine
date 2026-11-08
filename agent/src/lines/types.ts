// 新内核里几处共用的形状：工具怎么声明自己（大白话、硬线）、模型从哪来、定时怎么排。

import type { AgentTool, StreamFn, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, AssistantMessage, Context, Model } from '@earendil-works/pi-ai';
import { HARD_LINES } from '../../shared/act-or-ask.ts';
import type { LineKind } from '../../shared/api/lines.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';

/** 硬线的五类，和 shared/act-or-ask.ts 的 HARD_LINES 一一对上（顺序相同）。 */
export const HARD_LINE_KINDS = ['spend', 'outward', 'irreversible', 'permission', 'in_person'] as const;
export type HardLineKind = (typeof HARD_LINE_KINDS)[number];

export const HARD_LINE_LABELS: Readonly<Record<HardLineKind, string>> = {
  spend: HARD_LINES[0],
  outward: HARD_LINES[1],
  irreversible: HARD_LINES[2],
  permission: HARD_LINES[3],
  in_person: HARD_LINES[4],
};

/** 工具跑在哪条线上：它要用线的 id 出卡、开子线。 */
export interface LineScope {
  lineId: string;
  kind: LineKind;
  projectId: string | null;
}

export type ToolArgs = Record<string, unknown>;

/**
 * 新内核的工具：pi 的工具本体，加上它自己声明的两件事——这一步用大白话怎么说（「在 Mac 上验证签名」），
 * 属不属于硬线（属于就先问他，只放行这一次）。参数已经过 schema 校验才会交给 say / hardLine。
 */
export interface KernelTool {
  name: string;
  say(args: ToolArgs): string;
  hardLine(args: ToolArgs): HardLineKind | null;
  /** 硬线卡上的后果提示（「发出后对方会收到，撤不回」）；不写用这一类硬线的默认说法。 */
  consequence?(args: ToolArgs): string;
  /** 硬线卡上同意那个按钮的字（「发出」）；不写是「同意这一次」。 */
  approveLabel?(args: ToolArgs): string;
  /** 硬线卡上画出来的样子（任务卡）；记进卡的 context.preview，界面按它的格式画。 */
  preview?(args: ToolArgs): Record<string, unknown> | null;
  /** 这一轮能不能用（他在工具组里关掉的就看不到）；不写就是一直能用。 */
  enabled?(): boolean;
  /** 只给哪几种线（line_outcome 只给后台线）；不写就是每种线都有。 */
  lineKinds?: readonly LineKind[];
  create(scope: LineScope): AgentTool;
}

export interface CompleteOptions {
  signal?: AbortSignal;
  /** 不给就用模型选择里的推理档。 */
  reasoning?: ThinkingLevel;
  maxTokens?: number;
}

export interface ModelChoice {
  model: Model<Api>;
  thinking: ThinkingLevel;
}

/** 模型从哪来：kernel/ 用 SQLite 凭证接真的提供商，测试用 pi-ai 的假模型。 */
export interface ModelSource {
  /** 现在用哪个模型；还没连接任何提供商时是 undefined。 */
  current(purpose?: ModelPurpose): ModelChoice | undefined;
  streamFn: StreamFn;
  /** 一次不流式的请求（压缩时写摘要；笔记、翻译这类旁路调用也走它）。 */
  complete(model: Model<Api>, context: Context, options?: CompleteOptions): Promise<AssistantMessage>;
}

/** 过 ms 毫秒后跑一次；返回取消。测试换成手拨的钟。 */
export type Later = (ms: number, run: () => void) => () => void;

export const realLater: Later = (ms, run) => {
  const timer = setTimeout(run, ms);
  // 定时的接着跑不该挡住进程退出：退出前 stop() 会取消它们，重启后从库里重新排。
  timer.unref();
  return () => clearTimeout(timer);
};

/** 等 ms 毫秒；中途叫停就提前回 false。 */
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
