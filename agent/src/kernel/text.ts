// 旁路的模型调用（笔记 AI、网页翻译、信息流选材与评论、图书大纲、记账截图、分身答话、记忆整理）：一问一答、不带工具，
// 只要回答的文字。和线用同一份用途配置与凭证（kernel/models.ts）；实际模型和思考强度由对应用途决定。
// 2026-11-05 Harness 重做后旧的模型通道（agent/src/model/）删掉，所有调模型的地方都从这里走。

import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import { normalizeContext, type Api, type AssistantMessage, type Context, type ImageContent, type Message,
  type Model, type TextContent } from '@earendil-works/pi-ai';
import type { ReasoningLevel } from '../../shared/model.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';
import { classifyFailure, type CompleteOptions, type ModelChoice, type ModelSource } from '../lines/index.ts';

export interface TextImage {
  data: string;
  mimeType: string;
}

export interface TextMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: readonly TextImage[];
}

export interface TextRequest {
  purpose?: ModelPurpose;
  system: string;
  messages: readonly TextMessage[];
  /** 不给就用设置里选的推理档。 */
  reasoning?: ReasoningLevel;
  maxOutputTokens?: number;
}

export interface TextAnswer {
  text: string;
  /** false：写到长度上限被截断了。 */
  complete: boolean;
}

/** 边生成边要字的调用方（笔记续写，2026-11-09）给这个：每来一段回答的文字调一次。 */
export type TextDeltas = (delta: string) => void;

/** 旁路调用只认这一个口子；测试给假的。不流式的实现可以不理 onText，调用方最后照样拿到全文。 */
export interface TextModels {
  ask(request: TextRequest, signal: AbortSignal, onText?: TextDeltas): Promise<TextAnswer>;
  /** 缓存与排队任务先固定一次选择；身份包含真正生效的模型和思考强度。 */
  snapshot?(purpose: ModelPurpose): { identity: string; models: TextModels };
}

/** 没连模型、额度用完、登录失效、连不上（可以稍后再试）、其余。分法和线一样（lines/failure.ts）。 */
export type TextModelErrorKind = 'no_model' | 'quota' | 'auth' | 'busy' | 'failed';

export class TextModelError extends Error {
  readonly kind: TextModelErrorKind;
  /** 额度用完时错误里写的恢复时间（ISO）；没有就是 null。 */
  readonly retryAt: string | null;

  constructor(kind: TextModelErrorKind, message: string, retryAt: string | null = null) {
    super(message);
    this.name = 'TextModelError';
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

function failureOf(response: AssistantMessage, now: Date): TextModelError {
  const verdict = classifyFailure(response, now);
  if (verdict.kind === 'quota') {
    return new TextModelError('quota', verdict.reason, verdict.until.toISOString());
  }
  if (verdict.kind === 'retry') {
    return new TextModelError('busy', verdict.reason);
  }
  const auth = verdict.reason.startsWith('模型登录失效');
  return new TextModelError(auth ? 'auth' : 'failed', verdict.reason);
}

export const NO_MODEL_TEXT = '还没有连接模型：先在设置 · AI 里登录或填 key。';

/** 旧的八档推理 → pi 的档：max、ultra 都给到 max，off 交给 complete 处理成不传。 */
export function thinkingOf(level: ReasoningLevel): ThinkingLevel {
  return level === 'ultra' ? 'max' : level;
}

function toMessage(message: TextMessage, at: number, model: { api: string; provider: string; id: string }): Message {
  if (message.role === 'user') {
    const images: ImageContent[] = (message.images ?? []).map((image) => ({ type: 'image', data: image.data,
      mimeType: image.mimeType }));
    const content: (TextContent | ImageContent)[] = [{ type: 'text', text: message.content }, ...images];
    return { role: 'user', content: images.length === 0 ? message.content : content, timestamp: at };
  }
  const reply: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: message.content }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: at,
  };
  return reply;
}

function answerOf(message: AssistantMessage): string {
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
}

/**
 * 和主线一样走 streamFn（pi-ai 的 streamSimple），把回答文字的增量交出去，最后拿整条回答。
 * 「关」不传推理档：和 KernelModels.complete、pi-agent-core 调 streamFn 一样。
 */
async function streamed(models: ModelSource, model: Model<Api>, context: Context, options: CompleteOptions,
  onText: TextDeltas): Promise<AssistantMessage> {
  const { reasoning, ...rest } = options;
  // streamFn 和主线一样收 pi-ai 的 transcript（系统提示折成第一条），用 pi-ai 自己的 normalizeContext 转。
  const stream = await models.streamFn(model, normalizeContext(context),
    reasoning === undefined || reasoning === 'off' ? rest : { ...rest, reasoning });
  for await (const event of stream) {
    if (event.type === 'text_delta') {
      onText(event.delta);
    }
  }
  return stream.result();
}

export function kernelText(models: ModelSource, now: () => Date = () => new Date()): TextModels {
  const ask = async (request: TextRequest, signal: AbortSignal, choice: ModelChoice | undefined,
    onText: TextDeltas | undefined): Promise<TextAnswer> => {
    signal.throwIfAborted();
    if (choice === undefined) {
      throw new TextModelError('no_model', NO_MODEL_TEXT);
    }
    const at = now().getTime();
    const messages = request.messages.map((message) => toMessage(message, at, choice.model));
    const context: Context = { systemPrompt: request.system, messages };
    const options: CompleteOptions = {
      signal,
      reasoning: request.purpose !== undefined || request.reasoning === undefined
        ? choice.thinking : thinkingOf(request.reasoning),
      ...(request.maxOutputTokens === undefined ? {}
        : { maxTokens: Math.min(request.maxOutputTokens, choice.model.maxTokens) }),
    };
    const response = onText === undefined ? await models.complete(choice.model, context, options)
      : await streamed(models, choice.model, context, options, onText);
    signal.throwIfAborted();
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throw failureOf(response, now());
    }
    return { text: answerOf(response), complete: response.stopReason !== 'length' };
  };
  return {
    ask: (request, signal, onText) => ask(request, signal, models.current(request.purpose), onText),
    snapshot(purpose) {
      const choice = models.current(purpose);
      const identity = choice === undefined ? 'unconfigured'
        : `${choice.model.provider}/${choice.model.id}/${choice.thinking}`;
      return { identity, models: {
        ask: (request, signal, onText) => ask({ ...request, purpose }, signal, choice, onText),
      } };
    },
  };
}
