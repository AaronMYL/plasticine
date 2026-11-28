import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import { normalizeContext, type Api, type AssistantMessage, type Context, type ImageContent, type Message,
  type Model, type TextContent } from '@earendil-works/pi-ai';
import type { ReasoningLevel } from '../../shared/model.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';
import { classifyFailure, logModelFailure, type CompleteOptions, type ModelChoice, type ModelSource }
  from '../lines/index.ts';

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
  reasoning?: ReasoningLevel;
  maxOutputTokens?: number;
}

export interface TextAnswer {
  text: string;
  complete: boolean;
}

export type TextDeltas = (delta: string) => void;

export interface TextModels {
  ask(request: TextRequest, signal: AbortSignal, onText?: TextDeltas): Promise<TextAnswer>;
  snapshot?(purpose: ModelPurpose): { identity: string; models: TextModels };
}

export type TextModelErrorKind = 'no_model' | 'quota' | 'auth' | 'busy' | 'failed';

export class TextModelError extends Error {
  readonly kind: TextModelErrorKind;
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
  logModelFailure(response, verdict);
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

async function streamed(models: ModelSource, model: Model<Api>, context: Context, options: CompleteOptions,
  onText: TextDeltas): Promise<AssistantMessage> {
  const { reasoning, ...rest } = options;
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
      usage: { purpose: request.purpose ?? 'other' },
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
