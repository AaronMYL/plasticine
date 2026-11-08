// 新内核的模型从哪来：pi-ai 的 Models 集合，装上 pi-ai 内置的全部提供商（一律平级，2026-11-05 他定），凭证存在
// plasticine.sqlite（credentials.ts）。只用存下的凭证：不读服务器上的环境变量或别的文件（authContext 是空的），
// 免得哪个环境变量里的 key 不声不响地被用上。默认模型他在设置里选；选的那家没连上就退到列表里第一家连着的。

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
import type { CompleteOptions, ModelChoice, ModelSource } from '../lines/index.ts';
import type { StateService } from '../state/index.ts';
import { SqliteCredentialStore } from './credentials.ts';

export type KernelModelState = Pick<StateService, 'kernelCredentials' | 'kernelSettings'>;

const DEVICE_ID_KEY = 'device_id';
const DEFAULT_MODEL_KEY = 'default_model';
const CONFIG_KEY = 'model_purposes';
export { DEFAULT_THINKING };

/** 只用库里存的凭证：不碰环境变量、不看文件。 */
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
  /** 测试换成假的提供商；不给就是 pi-ai 内置的全部。 */
  providers?: readonly Provider[];
}

interface StoredConfig extends ModelSettings {
  version: number;
}

/** 存下的启用集合：provider id → 模型 id 列表；形状不对的那家当没设过。 */
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

/** 目录价：每百万 token 输入加输出；目录里是 0 就当不知道。 */
function priceOf(model: Model<Api>): number | null {
  const total = model.cost.input + model.cost.output;
  return total > 0 ? total : null;
}

const INHERIT: ModelOverride = { model: null, thinking: null };

export class KernelModels implements ModelSource {
  readonly models: MutableModels;
  readonly credentials: SqliteCredentialStore;
  readonly #state: KernelModelState;
  readonly #order: string[];

  constructor(options: KernelModelsOptions) {
    this.#state = options.state;
    this.credentials = new SqliteCredentialStore(options.state);
    this.models = createModels({ credentials: this.credentials, authContext: STORED_ONLY,
      identity: { attribution: null } });
    const providers = options.providers ?? builtinProviders();
    for (const provider of providers) {
      this.models.setProvider(provider);
    }
    this.#order = providers.map((provider) => provider.id);
  }

  readonly streamFn: ModelSource['streamFn'] = (model, context, options) =>
    this.models.streamSimple(model, context, options);

  complete(model: Model<Api>, context: Context, options: CompleteOptions = {}): Promise<AssistantMessage> {
    const { reasoning, ...rest } = options;
    // pi-ai 的 off 就是不传推理档。
    return this.models.completeSimple(model, context,
      reasoning === undefined || reasoning === 'off' ? rest : { ...rest, reasoning });
  }

  #provider(providerId: string): Provider {
    const provider = this.models.getProvider(providerId);
    if (provider === undefined || provider.getModels().length === 0) {
      throw new KernelModelError('not_found', `没有这家模型提供商：${providerId}。`);
    }
    return provider;
  }

  /** 列表照 pi-ai 的提供商顺序，一律平级；没有对话模型的（只做分类、出图的）不列。 */
  providers(): ModelProviderView[] {
    const enabled = this.enabled();
    return this.#order.flatMap((id) => {
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
        name: provider.name,
        methods,
        loginLabel: provider.auth.oauth?.loginLabel ?? provider.auth.oauth?.name ?? null,
        connected: this.credentials.connectedType(provider.id),
        ...this.credentials.label(provider.id),
        models: provider.getModels().map((model) => ({ id: model.id, name: model.name,
          contextWindow: model.contextWindow, reasoning: model.reasoning,
          thinkingLevels: getSupportedThinkingLevels(model), input: model.input })),
        enabled: enabled[provider.id] ?? [],
      }];
    });
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
    // 只在第一次升级时读旧选择；明确的新继承设置不能又被旧值覆盖。
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

  /** 目录：pi-ai 的提供商和模型，连没连、目录价；给共用的解析规则用。 */
  #catalog(): CatalogProvider[] {
    return this.#order.flatMap((id) => {
      const provider = this.models.getProvider(id);
      if (provider === undefined || provider.getModels().length === 0) {
        return [];
      }
      return [{ id, name: provider.name, connected: this.credentials.connectedType(id) !== null,
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

  /** 每家启用的模型 id。 */
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
    // 旧的「选默认模型」入口（连接页）：选中的顺手启用。
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
    // 没设过启用集合的那几家先按改之前「被用到的」定下来，免得换了默认原来那个就不见了。
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

  /** 填 key：只存，不回显。 */
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

  /** 这个安装的设备 UUID（订阅登录要它当 agent host id）：第一次用时生成，存库，之后一直是它。 */
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
