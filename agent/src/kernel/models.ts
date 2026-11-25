import { randomUUID } from 'node:crypto';
import { clampThinkingLevel, createModels, getSupportedThinkingLevels,
  type Api, type AssistantMessage, type AuthContext, type Context, type Model,
  type MutableModels, type Provider } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import { Value } from 'typebox/value';
import { ModelChoiceViewSchema, ModelOverrideSchema, THINKING_LEVELS,
  type ModelChoiceView, type ModelOverride, type ModelProviderView, type ModelPurposeView,
  type ProviderAuthMethod, type SaveModelConfigRequest }
  from '../../shared/api/model-providers.ts';
import { providerDisplayName } from '../../shared/api/model-names.ts';
import { DEFAULT_THINKING, ModelResolver, type CatalogProvider, type ModelSettings }
  from '../../shared/api/model-resolve.ts';
import { MODEL_PURPOSES, requiresImages, type ModelPurpose } from '../../shared/api/model-purposes.ts';
import type { CompleteOptions, ModelChoice, ModelSource, UsageTag } from '../lines/index.ts';
import type { StateService } from '../state/index.ts';
import { ACCOUNT_MODEL_PROVIDERS, ACCOUNT_MODELS_FRESH_MS, isEstimated, SettingsModelsStore, withAccountModels,
  type AccountModelsOptions } from './account-models.ts';
import { SqliteCredentialStore } from './credentials.ts';
import { safeLog } from '../util/index.ts';
import { customProvider, readCustomProviders, upgradeCustomProviders, type CustomProviderConfig }
  from './custom-providers.ts';

export type KernelModelState = Pick<StateService, 'kernelCredentials' | 'kernelSettings' | 'modelCalls'>;

const DEVICE_ID_KEY = 'device_id';
const ACCOUNT_MODELS_FIRST_DELAY_MS = 30_000;
const DEFAULT_MODEL_KEY = 'default_model';
const CONFIG_KEY = 'model_purposes';
export { DEFAULT_THINKING };

const STORED_ONLY: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

export class KernelModelError extends Error {
  readonly code: 'not_found' | 'invalid' | 'conflict';

  constructor(code: 'not_found' | 'invalid' | 'conflict', message: string) {
    super(message);
    this.name = 'KernelModelError';
    this.code = code;
  }
}

function isThinking(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value);
}

function storedChoice(value: unknown): ModelChoiceView | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const provider: unknown = Reflect.get(value, 'provider');
  const model: unknown = Reflect.get(value, 'model');
  const thinking: unknown = Reflect.get(value, 'thinking');
  if (typeof provider !== 'string' || typeof model !== 'string') {
    return null;
  }
  return { provider, model, thinking: isThinking(thinking) ? thinking : DEFAULT_THINKING };
}

export interface KernelModelsOptions {
  state: KernelModelState;
  providers?: readonly Provider[];
  accountModels?: AccountModelsOptions;
}

interface StoredConfig extends ModelSettings {
  version: number;
}

function storedEnabled(value: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (typeof value !== 'object' || value === null) {
    return result;
  }
  for (const [provider, models] of Object.entries(value)) {
    if (Array.isArray(models) && models.every((model) => typeof model === 'string')) {
      result[provider] = models;
    }
  }
  return result;
}

function priceOf(model: Model<Api>): number | null {
  const total = model.cost.input + model.cost.output;
  return total > 0 ? total : null;
}

const INHERIT: ModelOverride = { model: null, thinking: null };

function customInfo(config: CustomProviderConfig | undefined): ModelProviderView['custom'] {
  return config === undefined ? null : { baseUrl: config.baseUrl, protocol: config.protocol };
}

const PROVIDER_NAMES: Readonly<Record<string, string>> = { 'openai-codex': 'ChatGPT（Codex）' };

export class KernelModels implements ModelSource {
  readonly models: MutableModels;
  readonly credentials: SqliteCredentialStore;
  readonly #state: KernelModelState;
  readonly #builtin: string[];

  constructor(options: KernelModelsOptions) {
    this.#state = options.state;
    this.credentials = new SqliteCredentialStore(options.state);
    this.models = createModels({ credentials: this.credentials, authContext: STORED_ONLY,
      identity: { attribution: null }, modelsStore: new SettingsModelsStore(options.state) });
    const providers = (options.providers ?? builtinProviders())
      .map((provider) => withAccountModels(provider, options.accountModels));
    for (const provider of providers) {
      this.models.setProvider(provider);
    }
    this.#builtin = providers.map((provider) => provider.id);
    upgradeCustomProviders(this.#state);
    for (const config of this.customConfigs()) {
      this.models.setProvider(customProvider(config));
    }
  }

  customConfigs(): CustomProviderConfig[] {
    return readCustomProviders(this.#state);
  }

  #order(): string[] {
    return [...this.#builtin, ...this.customConfigs().map((config) => config.id)];
  }

  register(config: CustomProviderConfig): void {
    this.models.setProvider(customProvider(config));
  }

  readonly streamFn: ModelSource['streamFn'] = (model, context, options) => {
    const { usage, ...rest } = (options ?? {}) as NonNullable<typeof options> & { usage?: UsageTag };
    const stream = this.models.streamSimple(model, context, rest);
    if (usage !== undefined) {
      void Promise.resolve(stream).then((started) => started.result())
        .then((message) => this.#recordUsage(usage, message), () => undefined);
    }
    return stream;
  };

  async complete(model: Model<Api>, context: Context, options: CompleteOptions = {}): Promise<AssistantMessage> {
    const { reasoning, usage, ...rest } = options;
    const response = await this.models.completeSimple(model, context,
      reasoning === undefined || reasoning === 'off' ? rest : { ...rest, reasoning });
    if (usage !== undefined) {
      this.#recordUsage(usage, response);
    }
    return response;
  }

  #recordUsage(tag: UsageTag, message: AssistantMessage): void {
    try {
      const usage = message.usage;
      this.#state.modelCalls.record({ purpose: tag.purpose, lineId: tag.lineId ?? null, provider: message.provider,
        model: message.model, input: usage.input, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
        output: usage.output, cost: usage.cost.total });
    } catch (error) {
      safeLog('warn', 'model_usage_record_failed', { error });
    }
  }

  #provider(providerId: string): Provider {
    const provider = this.models.getProvider(providerId);
    if (provider === undefined || provider.getModels().length === 0) {
      throw new KernelModelError('not_found', `没有这家模型提供商：${providerId}。`);
    }
    return provider;
  }

  providers(): ModelProviderView[] {
    const enabled = this.enabled();
    const custom = new Map(this.customConfigs().map((config) => [config.id, config]));
    return this.#order().flatMap((id) => {
      const provider = this.models.getProvider(id);
      if (provider === undefined || provider.getModels().length === 0) {
        return [];
      }
      const methods: ProviderAuthMethod[] = [
        ...(provider.auth.oauth === undefined ? [] : ['oauth' as const]),
        ...(provider.auth.apiKey?.login === undefined ? [] : ['api_key' as const]),
      ];
      return [{
        id: provider.id,
        name: PROVIDER_NAMES[provider.id] ?? provider.name,
        methods,
        loginLabel: provider.auth.oauth?.loginLabel ?? provider.auth.oauth?.name ?? null,
        connected: this.credentials.connectedType(provider.id),
        ...this.credentials.label(provider.id),
        models: provider.getModels().map((model) => ({ id: model.id, name: model.name,
          contextWindow: model.contextWindow, reasoning: model.reasoning,
          thinkingLevels: getSupportedThinkingLevels(model), input: model.input,
          ...(isEstimated(model) ? { estimated: true } : {}) })),
        enabled: enabled[provider.id] ?? [],
        custom: customInfo(custom.get(provider.id)),
      }];
    });
  }

  async refreshAccountModels(options: { network: boolean; force?: boolean; signal?: AbortSignal }):
    Promise<{ failed: string[] }> {
    const result = await this.models.refresh({ providers: ACCOUNT_MODEL_PROVIDERS, allowNetwork: options.network,
      ...(options.force === undefined ? {} : { force: options.force }),
      ...(options.signal === undefined ? {} : { signal: options.signal }) });
    return { failed: [...result.errors.keys()] };
  }

  async startAccountModels(): Promise<() => void> {
    await this.refreshAccountModels({ network: false }).catch((error: unknown) => {
      safeLog('warn', 'account_models_failed', { error });
    });
    const run = (): void => {
      void this.refreshAccountModels({ network: true }).then(({ failed }) => {
        if (failed.length > 0) safeLog('warn', 'account_models_failed', { stepKey: failed.join(',') });
      }, (error: unknown) => {
        safeLog('warn', 'account_models_failed', { error });
      });
    };
    const first = setTimeout(run, ACCOUNT_MODELS_FIRST_DELAY_MS);
    const every = setInterval(run, ACCOUNT_MODELS_FRESH_MS);
    first.unref();
    every.unref();
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }

  supportsOAuth(providerId: string): boolean {
    return this.#provider(providerId).auth.oauth !== undefined;
  }

  chosen(): ModelChoiceView | null {
    return this.#stored().default;
  }

  #stored(): StoredConfig {
    const raw = this.#state.kernelSettings.get(CONFIG_KEY);
    const object = typeof raw === 'object' && raw !== null ? raw : {};
    const version: unknown = Reflect.get(object, 'version');
    const defaultChoice: unknown = Reflect.get(object, 'default');
    const overrides: StoredConfig['overrides'] = {};
    const rawOverrides: unknown = Reflect.get(object, 'overrides');
    for (const { id } of MODEL_PURPOSES) {
      const chosen: unknown = typeof rawOverrides === 'object' && rawOverrides !== null
        ? Reflect.get(rawOverrides, id) : undefined;
      if (Value.Check(ModelOverrideSchema, chosen)) overrides[id] = chosen;
    }
    const legacy = this.#state.kernelSettings.get('translate_model');
    const legacyChoice: unknown = typeof legacy === 'object' && legacy !== null ? Reflect.get(legacy, 'chosen') : null;
    const legacyVersion: unknown = typeof legacy === 'object' && legacy !== null ? Reflect.get(legacy, 'version') : 0;
    if (version === undefined && Value.Check(ModelChoiceViewSchema, legacyChoice)) {
      overrides.translation = { model: { provider: legacyChoice.provider, model: legacyChoice.model },
        thinking: legacyChoice.thinking };
    }
    return {
      version: typeof version === 'number' ? version : typeof legacyVersion === 'number' ? legacyVersion : 0,
      default: defaultChoice === undefined
        ? storedChoice(this.#state.kernelSettings.get(DEFAULT_MODEL_KEY)) : storedChoice(defaultChoice),
      overrides,
      enabled: storedEnabled(Reflect.get(object, 'enabled')),
    };
  }

  #catalog(): CatalogProvider[] {
    return this.#order().flatMap((id) => {
      const provider = this.models.getProvider(id);
      if (provider === undefined || provider.getModels().length === 0) {
        return [];
      }
      return [{ id, name: PROVIDER_NAMES[id] ?? provider.name, connected: this.credentials.connectedType(id) !== null,
        models: provider.getModels().map((model) => ({ id: model.id, name: model.name, input: model.input,
          thinkingLevels: getSupportedThinkingLevels(model), price: priceOf(model) })) }];
    });
  }

  #resolver(config: StoredConfig = this.#stored()): ModelResolver {
    return new ModelResolver(this.#catalog(), config, (provider, model, level) => {
      const found = this.models.getModel(provider, model);
      return found === undefined ? level : clampThinkingLevel(found, level);
    });
  }

  effective(purpose?: ModelPurpose): ModelChoiceView | null {
    return this.#resolver().resolve(purpose).effective;
  }

  defaultIssue(): string | null {
    return this.#resolver().resolve().issue;
  }

  enabled(): Record<string, string[]> {
    return this.#resolver().enabled;
  }

  settings(): { version: number; purposes: ModelPurposeView[] } {
    const config = this.#stored();
    const resolver = this.#resolver(config);
    return { version: config.version, purposes: MODEL_PURPOSES.map(({ id }) => {
      const { effective, issue } = resolver.resolve(id);
      return { purpose: id, chosen: config.overrides[id] ?? { ...INHERIT }, effective, issue };
    }) };
  }

  current(purpose?: ModelPurpose): ModelChoice | undefined {
    const choice = this.effective(purpose);
    const model = choice === null ? undefined : this.models.getModel(choice.provider, choice.model);
    return choice === null || model === undefined ? undefined : { model, thinking: choice.thinking };
  }

  setDefault(choice: { provider: string; model: string; thinking?: ThinkingLevel }): ModelChoiceView {
    const saved = { provider: choice.provider, model: choice.model, thinking: choice.thinking ?? DEFAULT_THINKING };
    const enabled = this.enabled()[choice.provider] ?? [];
    this.configure({ version: this.#stored().version, default: saved, purposes: [],
      enabled: [{ provider: choice.provider, models: [...enabled, choice.model] }] });
    return saved;
  }

  configure(input: Omit<SaveModelConfigRequest, 'requestId'>): void {
    const config = this.#stored();
    if (input.version !== config.version) {
      throw new KernelModelError('conflict', '模型设置刚在别处改过，重新读取后再保存。');
    }
    const before = this.#resolver(config).enabled;
    const enabled: Record<string, readonly string[]> = { ...config.enabled };
    for (const [provider, models] of Object.entries(before)) {
      if (enabled[provider] === undefined && models.length > 0) enabled[provider] = models;
    }
    const providersSeen = new Set<string>();
    for (const change of input.enabled ?? []) {
      if (providersSeen.has(change.provider)) throw new KernelModelError('invalid', '同一家不能重复设置。');
      providersSeen.add(change.provider);
      const provider = this.#provider(change.provider);
      const known = provider.getModels().map((model) => model.id);
      const unknown = change.models.find((model) => !known.includes(model));
      if (unknown !== undefined) {
        throw new KernelModelError('invalid', `「${provider.name}」没有这个模型：${unknown}。`);
      }
      enabled[change.provider] = known.filter((model) => change.models.includes(model));
    }
    const validate = (choice: ModelOverride['model'], purpose?: ModelPurpose): void => {
      if (choice === null) return;
      const provider = this.#provider(choice.provider);
      const model = this.models.getModel(choice.provider, choice.model);
      if (model === undefined) {
        throw new KernelModelError('invalid', `「${choice.provider}」没有这个模型：${choice.model}。`);
      }
      if (!(enabled[choice.provider] ?? []).includes(choice.model)) {
        throw new KernelModelError('invalid', `先在设置 · AI 里启用 ${providerDisplayName(provider)} 的 ${model.name}。`);
      }
      if (requiresImages(purpose) && !model.input.includes('image')) {
        throw new KernelModelError('invalid', '付款截图识别需要支持图片的模型，请重新选择。');
      }
    };
    if (input.default !== undefined) validate(input.default);
    const seen = new Set<ModelPurpose>();
    for (const change of input.purposes) {
      if (seen.has(change.purpose)) throw new KernelModelError('invalid', '同一用途不能重复设置。');
      seen.add(change.purpose);
      validate(change.chosen.model, change.purpose);
    }
    for (const change of input.purposes) config.overrides[change.purpose] = change.chosen;
    if (input.default !== undefined) config.default = input.default;
    this.#state.kernelSettings.set(CONFIG_KEY, { ...config, enabled, version: config.version + 1 });
  }

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    const provider = this.#provider(providerId);
    if (provider.auth.apiKey?.login === undefined) {
      throw new KernelModelError('invalid', `「${provider.name}」不用填 key。`);
    }
    await this.credentials.modify(providerId, async () => ({ type: 'api_key', key: apiKey.trim() }));
  }

  async logout(providerId: string): Promise<void> {
    this.#provider(providerId);
    await this.models.logout(providerId);
  }

  deviceId(): string {
    const stored = this.#state.kernelSettings.get(DEVICE_ID_KEY);
    if (typeof stored === 'string' && stored !== '') {
      return stored;
    }
    const id = randomUUID();
    this.#state.kernelSettings.set(DEVICE_ID_KEY, id);
    return id;
  }
}
