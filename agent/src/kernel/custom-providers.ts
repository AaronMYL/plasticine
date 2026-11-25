import { createProvider, type Api, type ApiKeyAuth, type Model, type Provider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { CUSTOM_PROTOCOLS, CUSTOM_PROVIDER_PREFIX, DEFAULT_CONTEXT_WINDOW, type CustomModel, type CustomProtocol }
  from '../../shared/api/custom-providers.ts';
import type { StateService } from '../state/index.ts';

export const CUSTOM_PROVIDERS_KEY = 'custom_providers';

const DEFAULT_MAX_TOKENS = 16_384;
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

export function readCustomProviders(state: SettingsState): CustomProviderConfig[] {
  const raw = state.kernelSettings.get(CUSTOM_PROVIDERS_KEY);
  return Array.isArray(raw) ? raw.flatMap((item) => configOf(item) ?? []) : [];
}

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
