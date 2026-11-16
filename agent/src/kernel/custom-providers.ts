// 自定义模型提供商（11-16 Aaron）：自己填的接口地址、协议和模型名，做成和内置的一样的 pi-ai 提供商。配置存在
// kernel_settings 的 custom_providers（一家一项），key 和别家一样存在 kernel_credentials（只写不读）。
// 不认识的服务器按最保守的兼容设置发：不带 store、不用 developer 角色、上限字段用 max_tokens。
// 每个模型能不能思考、能不能看图、上下文多长由他在表单里标（接口不会说）；能思考的给 不思考 / 较低 / 中等 / 较高四档
// （OpenAI 兼容和 Responses 按 reasoning_effort 发，Anthropic 按思考预算发），minimal 这档很多网关不认，不给。

import { createProvider, type Api, type ApiKeyAuth, type Model, type Provider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { CUSTOM_PROTOCOLS, CUSTOM_PROVIDER_PREFIX, DEFAULT_CONTEXT_WINDOW, type CustomModel, type CustomProtocol }
  from '../../shared/api/custom-providers.ts';
import type { StateService } from '../state/index.ts';

export const CUSTOM_PROVIDERS_KEY = 'custom_providers';

/** 一次最多写多少：16k，上下文短的不超过它的一半。 */
const DEFAULT_MAX_TOKENS = 16_384;
/** 填 key 可以留空（本机的模型服务不要 key）；SDK 要一个非空值。 */
const NO_KEY = 'no-key';

export interface CustomProviderConfig {
  id: string;
  name: string;
  protocol: CustomProtocol;
  baseUrl: string;
  models: CustomModel[];
}

type SettingsState = Pick<StateService, 'kernelSettings'>;

function isProtocol(value: unknown): value is CustomProtocol {
  return typeof value === 'string' && (CUSTOM_PROTOCOLS as readonly string[]).includes(value);
}

/** 一个模型：11-16 第一版只存了名字（字符串），读的时候补成默认的几样。 */
function modelEntry(value: unknown): CustomModel | null {
  if (typeof value === 'string') {
    return value === '' ? null : { id: value, reasoning: false, images: true, contextWindow: DEFAULT_CONTEXT_WINDOW };
  }
  if (typeof value !== 'object' || value === null) return null;
  const id: unknown = Reflect.get(value, 'id');
  const reasoning: unknown = Reflect.get(value, 'reasoning');
  const images: unknown = Reflect.get(value, 'images');
  const contextWindow: unknown = Reflect.get(value, 'contextWindow');
  if (typeof id !== 'string' || id === '') return null;
  return { id, reasoning: reasoning === true, images: images !== false,
    contextWindow: typeof contextWindow === 'number' && contextWindow >= 1_000
      ? contextWindow : DEFAULT_CONTEXT_WINDOW };
}

function configOf(value: unknown): CustomProviderConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const id: unknown = Reflect.get(value, 'id');
  const name: unknown = Reflect.get(value, 'name');
  const protocol: unknown = Reflect.get(value, 'protocol');
  const baseUrl: unknown = Reflect.get(value, 'baseUrl');
  const models: unknown = Reflect.get(value, 'models');
  const fine = typeof id === 'string' && id.startsWith(CUSTOM_PROVIDER_PREFIX) && typeof name === 'string'
    && isProtocol(protocol) && typeof baseUrl === 'string' && Array.isArray(models);
  return fine ? { id, name, protocol, baseUrl, models: models.flatMap((model) => modelEntry(model) ?? []) } : null;
}

/** 存着的自定义提供商；形状不对的那一项跳过。 */
export function readCustomProviders(state: SettingsState): CustomProviderConfig[] {
  const raw = state.kernelSettings.get(CUSTOM_PROVIDERS_KEY);
  return Array.isArray(raw) ? raw.flatMap((item) => configOf(item) ?? []) : [];
}

/** 第一版只存了模型名的，整理成现在的样子写回去（升级不留旧格式）；回有没有改。 */
export function upgradeCustomProviders(state: SettingsState): boolean {
  const raw = state.kernelSettings.get(CUSTOM_PROVIDERS_KEY);
  const configs = readCustomProviders(state);
  if (JSON.stringify(raw ?? []) === JSON.stringify(configs)) return false;
  writeCustomProviders(state, configs);
  return true;
}

export function writeCustomProviders(state: SettingsState, configs: readonly CustomProviderConfig[]): void {
  state.kernelSettings.set(CUSTOM_PROVIDERS_KEY, configs);
}

/** 地址去掉结尾的斜杠；Anthropic 的 SDK 自己会接 /v1/messages，填了 /v1 的去掉。 */
export function sdkBaseUrl(protocol: CustomProtocol, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return protocol === 'anthropic-messages' ? trimmed.replace(/\/v1$/, '') : trimmed;
}

function modelOf(config: Omit<CustomProviderConfig, 'models'>, entry: CustomModel): Model<Api> {
  const base = {
    id: entry.id, name: entry.id, api: config.protocol, provider: config.id,
    baseUrl: sdkBaseUrl(config.protocol, config.baseUrl),
    input: (entry.images ? ['text', 'image'] : ['text']) as ('text' | 'image')[], reasoning: entry.reasoning,
    ...(entry.reasoning ? { thinkingLevelMap: { minimal: null } } : {}),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: entry.contextWindow,
    maxTokens: Math.min(DEFAULT_MAX_TOKENS, Math.floor(entry.contextWindow / 2)),
  };
  if (config.protocol !== 'openai-completions') return base;
  return { ...base, compat: { supportsStore: false, supportsDeveloperRole: false,
    supportsReasoningEffort: entry.reasoning, maxTokensField: 'max_tokens' } } as Model<Api>;
}

/** 存着的 key；留空也算连上了（本机模型服务）。 */
function keyAuth(name: string): ApiKeyAuth {
  return {
    name: `${name} API key`,
    resolve: async ({ credential, signal }) => {
      signal.throwIfAborted();
      if (credential === undefined) return undefined;
      const key = credential.key === undefined || credential.key === '' ? NO_KEY : credential.key;
      return { auth: { apiKey: key }, source: 'stored credential' };
    },
  };
}

function apiOf(protocol: CustomProtocol) {
  if (protocol === 'anthropic-messages') return anthropicMessagesApi();
  return protocol === 'openai-responses' ? openAIResponsesApi() : openAICompletionsApi();
}

/** 一家自定义提供商做成 pi-ai 的提供商。 */
export function customProvider(config: CustomProviderConfig): Provider {
  return createProvider({
    id: config.id,
    name: config.name,
    baseUrl: sdkBaseUrl(config.protocol, config.baseUrl),
    auth: { apiKey: keyAuth(config.name) },
    models: config.models.map((entry) => modelOf(config, entry)),
    api: apiOf(config.protocol),
  });
}
