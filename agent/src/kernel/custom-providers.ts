// 自定义模型提供商（11-16 Aaron）：自己填的接口地址、协议和模型名，做成和内置的一样的 pi-ai 提供商。配置存在
// kernel_settings 的 custom_providers（一家一项），key 和别家一样存在 kernel_credentials（只写不读）。
// 不认识的服务器按最保守的兼容设置发：不带 store、不用 developer 角色、上限字段用 max_tokens。

import { createProvider, type Api, type ApiKeyAuth, type Model, type Provider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { CUSTOM_PROTOCOLS, CUSTOM_PROVIDER_PREFIX, type CustomProtocol }
  from '../../shared/api/custom-providers.ts';
import type { StateService } from '../state/index.ts';

export const CUSTOM_PROVIDERS_KEY = 'custom_providers';

/** 不知道上下文多长、一次最多写多少时的默认值（和常见的兼容接口对得上，不够再加设置）。 */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
/** 填 key 可以留空（本机的模型服务不要 key）；SDK 要一个非空值。 */
const NO_KEY = 'no-key';

export interface CustomProviderConfig {
  id: string;
  name: string;
  protocol: CustomProtocol;
  baseUrl: string;
  models: string[];
}

type SettingsState = Pick<StateService, 'kernelSettings'>;

function isProtocol(value: unknown): value is CustomProtocol {
  return typeof value === 'string' && (CUSTOM_PROTOCOLS as readonly string[]).includes(value);
}

function configOf(value: unknown): CustomProviderConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const id: unknown = Reflect.get(value, 'id');
  const name: unknown = Reflect.get(value, 'name');
  const protocol: unknown = Reflect.get(value, 'protocol');
  const baseUrl: unknown = Reflect.get(value, 'baseUrl');
  const models: unknown = Reflect.get(value, 'models');
  const fine = typeof id === 'string' && id.startsWith(CUSTOM_PROVIDER_PREFIX) && typeof name === 'string'
    && isProtocol(protocol) && typeof baseUrl === 'string' && Array.isArray(models)
    && models.every((model) => typeof model === 'string');
  return fine ? { id, name, protocol, baseUrl, models: [...models] as string[] } : null;
}

/** 存着的自定义提供商；形状不对的那一项跳过。 */
export function readCustomProviders(state: SettingsState): CustomProviderConfig[] {
  const raw = state.kernelSettings.get(CUSTOM_PROVIDERS_KEY);
  return Array.isArray(raw) ? raw.flatMap((item) => configOf(item) ?? []) : [];
}

export function writeCustomProviders(state: SettingsState, configs: readonly CustomProviderConfig[]): void {
  state.kernelSettings.set(CUSTOM_PROVIDERS_KEY, configs);
}

/** 地址去掉结尾的斜杠；Anthropic 的 SDK 自己会接 /v1/messages，填了 /v1 的去掉。 */
export function sdkBaseUrl(protocol: CustomProtocol, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return protocol === 'anthropic-messages' ? trimmed.replace(/\/v1$/, '') : trimmed;
}

function modelOf(config: Omit<CustomProviderConfig, 'models'>, id: string): Model<Api> {
  const base = {
    id, name: id, api: config.protocol, provider: config.id, baseUrl: sdkBaseUrl(config.protocol, config.baseUrl),
    input: ['text', 'image'] as ('text' | 'image')[], reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS,
  };
  if (config.protocol !== 'openai-completions') return base;
  return { ...base, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
    maxTokensField: 'max_tokens' } } as Model<Api>;
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
    models: config.models.map((id) => modelOf(config, id)),
    api: apiOf(config.protocol),
  });
}
