// 测试连接的第二步：让一个模型回一句（11-16）。和真正用的时候一样经 pi-ai 发；标了能思考的带「较低」思考，
// 能看图的带一张 16×16 的小图。没成而且是请求本身被拒（4xx，不是 key、限流、模型名的问题）时，拆掉思考或图片再试，
// 拆掉以后能回就说清是哪一样不认，免得他只看到一句「请求没成功」。

import { createModels, InMemoryCredentialStore, type AssistantMessage, type AuthContext,
  type ImageContent, type TextContent } from '@earendil-works/pi-ai';
import type { ConnectionTestStep, CustomModel, CustomProtocol } from '../../shared/api/custom-providers.ts';
import { bodyDetail, clip, errorStatus, networkReason, statusReason, step, withStatus }
  from './connection-reasons.ts';
import { customProvider } from './custom-providers.ts';

const REPLY_MAX_TOKENS = 64;
const TEST_PROVIDER_ID = 'custom-connection-test';
const STORED_ONLY: AuthContext = { env: async () => undefined, fileExists: async () => false };
/** 16×16 的一块陶土色（测「能看图」用）。 */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGM4URFAEmIY1TCqYfhqAAAe+5AQTySC1gAAAABJ'
  + 'RU5ErkJggg==';
/** 请求本身被拒、值得拆掉思考或图片再试的状态码。 */
const REJECTED = new Set([400, 415, 422]);

export interface ReplyInput {
  protocol: CustomProtocol;
  baseUrl: string;
  apiKey: string;
  model: CustomModel;
}

export interface ReplyContext {
  fetch: typeof fetch;
  /** 每试一次给一个新的信号（各自计时）。 */
  signal: () => AbortSignal;
  now: () => number;
}

interface Attempt {
  answer: AssistantMessage;
  latencyMs: number;
  aborted: boolean;
}

function replyText(message: AssistantMessage): string {
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('').trim();
}

async function attempt(input: ReplyInput, model: CustomModel, context: ReplyContext): Promise<Attempt> {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(TEST_PROVIDER_ID, async () => ({ type: 'api_key', key: input.apiKey }));
  const models = createModels({ credentials, authContext: STORED_ONLY, identity: { attribution: null } });
  models.setProvider(customProvider({ id: TEST_PROVIDER_ID, name: '测试', protocol: input.protocol,
    baseUrl: input.baseUrl, models: [model] }));
  const found = models.getModel(TEST_PROVIDER_ID, model.id);
  if (found === undefined) throw new Error('测试用的模型没装上');
  const text: TextContent = { type: 'text', text: model.images ? '只回复图里的主色，一个词。' : '只回复 pong 这一个词。' };
  const image: ImageContent = { type: 'image', data: TINY_PNG, mimeType: 'image/png' };
  const signal = context.signal();
  const started = context.now();
  const answer = await models.completeSimple(found,
    { messages: [{ role: 'user', content: model.images ? [text, image] : [text], timestamp: Date.now() }] },
    { signal, maxTokens: REPLY_MAX_TOKENS, fetch: context.fetch, ...(model.reasoning ? { reasoning: 'low' } : {}) });
  return { answer, latencyMs: context.now() - started, aborted: signal.aborted };
}

function failed(answer: AssistantMessage): boolean {
  return answer.stopReason === 'error' || answer.stopReason === 'aborted';
}

function what(model: CustomModel): string {
  const parts = [model.images ? '带图' : null, model.reasoning ? '较低思考' : null].filter((part) => part !== null);
  return parts.length === 0 ? '' : `（${parts.join(' · ')}）`;
}

function failureStep(model: CustomModel, tried: Attempt): ConnectionTestStep {
  const raw = tried.answer.errorMessage ?? '没有说原因';
  const status = errorStatus(raw);
  // 去掉开头的状态码再取服务端的话。
  const detail = bodyDetail(raw.replace(/^\d{3}:?\s*/, '')) ?? clip(raw);
  const summary = tried.aborted ? '连了很久没有回应'
    : status === null ? networkReason(raw) : statusReason(status, detail, model.id);
  const named = summary.includes(model.id) ? summary : `${model.id}：${summary}`;
  return step('reply', false, withStatus(named, status),
    { detail, status, latencyMs: tried.latencyMs, model: model.id });
}

/** 拆掉一样再试：能回就说是这一样不认。 */
async function diagnose(input: ReplyInput, context: ReplyContext): Promise<ConnectionTestStep | null> {
  const model = input.model;
  const variants: [CustomModel, string][] = [
    ...(model.reasoning ? [[{ ...model, reasoning: false }, '不认思考参数，取消「能思考」'] as [CustomModel, string]] : []),
    ...(model.images ? [[{ ...model, images: false }, '不收图片，取消「能看图」'] as [CustomModel, string]] : []),
  ];
  for (const [variant, reason] of variants) {
    const tried = await attempt(input, variant, context);
    if (!failed(tried.answer)) {
      return step('reply', false, `${model.id} 能回复，但${reason}`, { detail: clip(replyText(tried.answer)) || null,
        latencyMs: tried.latencyMs, model: model.id });
    }
  }
  return null;
}

export async function replyStep(input: ReplyInput, context: ReplyContext): Promise<ConnectionTestStep> {
  const tried = await attempt(input, input.model, context);
  if (!failed(tried.answer)) {
    const text = replyText(tried.answer);
    return step('reply', true, `${input.model.id} 回复了${what(input.model)}`,
      { detail: text === '' ? null : clip(text), latencyMs: tried.latencyMs, model: input.model.id });
  }
  const status = errorStatus(tried.answer.errorMessage ?? '');
  const extras = input.model.reasoning || input.model.images;
  const found = extras && !tried.aborted && status !== null && REJECTED.has(status) ? await diagnose(input, context)
    : null;
  return found ?? failureStep(input.model, tried);
}
