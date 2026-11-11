// 假的模型连接（新内核 /v2/model-providers…）：几家平级的提供商，订阅登录给一个假的授权网址，交回调地址就算登上；
// 填 key 就算连上。密钥只写不读，列表里只说连没连、用哪种方式。

import type { ModelProvidersApi } from '../lines-client.ts';
import { ApiError } from '../errors.ts';
import {
  clampToLevels, MODEL_PURPOSES, ModelResolver, THINKING_LEVELS,
  type CatalogProvider, type ListModelProvidersResponse, type ModelChoiceView, type ModelEnabledChange,
  type ModelOverride, type ModelProviderView, type ModelPurpose, type ProviderLoginView,
  type SaveModelConfigRequest, type SetDefaultModelRequest,
} from '../shared.ts';
import type { FakeSession } from './fake-session.ts';

// price：假的目录价（每百万 token 输入加输出），心跳、做梦挑便宜的靠它。
const model = (id: string, name: string, price: number, reasoning = true) => ({ id, name, contextWindow: 200_000,
  reasoning, thinkingLevels: reasoning ? [...THINKING_LEVELS] : ['off' as const],
  input: ['text', 'image'] as ('text' | 'image')[], price });

type FakeModel = ReturnType<typeof model>;
type FakeProvider = Omit<ModelProviderView, 'models' | 'enabled'> & { models: FakeModel[] };

function provider(id: string, name: string, oauth: string | null, models: FakeModel[]): FakeProvider {
  return { id, name, methods: oauth === null ? ['api_key'] : ['oauth', 'api_key'], loginLabel: oauth, connected: null,
    account: null, plan: null, keyLast4: null, models };
}

const PROVIDERS: readonly FakeProvider[] = [
  provider('openai', 'OpenAI', 'Sign in with ChatGPT', [model('gpt-5.5', 'GPT-5.5', 35),
    model('gpt-5.5-mini', 'GPT-5.5 mini', 2.6), model('gpt-5.5-pro', 'GPT-5.5 Pro', 210), model('gpt-5.4', 'GPT-5.4', 17.5)]),
  provider('anthropic', 'Anthropic', 'Sign in with Claude', [model('claude-opus-5', 'Claude Opus 5', 30),
    model('claude-sonnet-5', 'Claude Sonnet 5', 12), model('claude-haiku-5', 'Claude Haiku 5', 0.6)]),
  provider('deepseek', 'DeepSeek', null, [model('deepseek-v4', 'DeepSeek V4', 5.3)]),
  provider('moonshotai-cn', 'Moonshot AI CN', null, [model('kimi-k3', 'Kimi K3', 4)]),
  provider('qwen-token-plan-cn', 'Qwen Token Plan CN', null, [model('qwen4-max', 'Qwen4 Max', 4)]),
  provider('zai', 'Z.AI', null, [model('glm-5', 'GLM-5', 4)]),
  provider('minimax-cn', 'MiniMax CN', null, [model('minimax-m3', 'MiniMax M3', 2)]),
  provider('groq', 'Groq', null, [model('llama-5-70b', 'Llama 5 70B', 1, false)]),
  provider('mistral', 'Mistral', null, [model('mistral-large-3', 'Mistral Large 3', 8)]),
];

export class FakeModelProviders implements ModelProvidersApi {
  private readonly session: FakeSession;
  private readonly connected = new Map<string, 'oauth' | 'api_key'>();
  /** 填过的 key 只留最后 4 位（和服务端一样不回显 key）。 */
  private readonly keyTails = new Map<string, string>();
  private readonly logins = new Map<string, ProviderLoginView>();
  private chosen: ModelChoiceView | null = null;
  private version = 0;
  private readonly overrides = new Map<ModelPurpose, ModelOverride>();
  private readonly enabled = new Map<string, string[]>();
  private serial = 0;

  constructor(session: FakeSession) {
    this.session = session;
  }

  /** 种子：这几家已经连上，默认模型选好。 */
  seedConnected(entries: ReadonlyArray<[string, 'oauth' | 'api_key']>, chosen: ModelChoiceView | null): void {
    for (const [id, method] of entries) {
      this.connected.set(id, method);
    }
    this.chosen = chosen;
  }

  /** 种子：几家启用的模型、几个用途单独选的。 */
  seedConfig(enabled: readonly ModelEnabledChange[], overrides: Partial<Record<ModelPurpose, ModelOverride>> = {}):
    void {
    for (const change of enabled) {
      this.enabled.set(change.provider, [...change.models]);
    }
    for (const [purpose, chosen] of Object.entries(overrides) as Array<[ModelPurpose, ModelOverride]>) {
      this.overrides.set(purpose, chosen);
    }
  }

  async list(): Promise<ListModelProvidersResponse> {
    this.session.require();
    return this.view();
  }

  async startLogin(providerId: string): Promise<ProviderLoginView> {
    this.session.require();
    this.require(providerId);
    this.serial += 1;
    const login: ProviderLoginView = { id: `login-${this.serial}`, providerId, status: 'waiting',
      url: `https://auth.example.com/authorize?provider=${providerId}`, instructions: null, deviceCode: null,
      prompt: { type: 'redirect_url', message: '把浏览器跳转到的地址贴到这里',
        placeholder: 'http://localhost:1455/auth/callback?code=…' },
      progress: null, error: null };
    this.logins.set(login.id, login);
    return structuredClone(login);
  }

  async login(_providerId: string, loginId: string): Promise<ProviderLoginView> {
    this.session.require();
    return structuredClone(this.requireLogin(loginId));
  }

  async completeLogin(providerId: string, loginId: string, _requestId: string, input: string)
    : Promise<ProviderLoginView> {
    this.session.require();
    const login = this.requireLogin(loginId);
    if (!input.includes('code=')) {
      const failed = { ...login, error: '这串地址里没有授权码，再从浏览器地址栏整串复制一次。' };
      this.logins.set(loginId, failed);
      return structuredClone(failed);
    }
    const done: ProviderLoginView = { ...login, status: 'done', prompt: null, error: null };
    this.logins.set(loginId, done);
    this.connected.set(providerId, 'oauth');
    return structuredClone(done);
  }

  async cancelLogin(_providerId: string, loginId: string): Promise<ProviderLoginView> {
    this.session.require();
    const cancelled: ProviderLoginView = { ...this.requireLogin(loginId), status: 'cancelled', prompt: null };
    this.logins.set(loginId, cancelled);
    return structuredClone(cancelled);
  }

  async setKey(providerId: string, _requestId: string, apiKey: string): Promise<ListModelProvidersResponse> {
    this.session.require();
    this.require(providerId);
    if (apiKey.trim().length < 8) {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400, message: '这串 key 太短了，再检查一下。' });
    }
    this.connected.set(providerId, 'api_key');
    this.keyTails.set(providerId, apiKey.trim().slice(-4));
    return this.view();
  }

  async logout(providerId: string): Promise<ListModelProvidersResponse> {
    this.session.require();
    this.connected.delete(providerId);
    return this.view();
  }

  async setDefault(body: SetDefaultModelRequest): Promise<ListModelProvidersResponse> {
    this.session.require();
    this.require(body.provider);
    // 和服务端一样：旧的「选默认模型」入口顺手启用选中的。
    const enabled = this.resolver().enabled[body.provider] ?? [];
    this.enabled.set(body.provider, [...enabled, body.model]);
    this.chosen = { provider: body.provider, model: body.model, thinking: body.thinking ?? 'medium' };
    this.version += 1;
    return this.view();
  }

  async saveConfig(body: SaveModelConfigRequest): Promise<ListModelProvidersResponse> {
    this.session.require();
    if (body.version !== this.version) {
      throw new ApiError({ kind: 'conflict', code: 'conflict', message: '模型设置刚在别处改过，再读一次后再保存。' });
    }
    const resolver = this.resolver();
    const enabled = new Map(Object.entries(resolver.enabled));
    for (const change of body.enabled ?? []) {
      const known = this.require(change.provider).models.map((item) => item.id);
      enabled.set(change.provider, known.filter((id) => change.models.includes(id)));
    }
    const choices = [...(body.default == null ? [] : [body.default]),
      ...body.purposes.flatMap((change) => change.chosen.model === null ? [] : [change.chosen.model])];
    for (const choice of choices) {
      if (!(enabled.get(choice.provider) ?? []).includes(choice.model)) {
        throw new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400,
          message: `先在设置 · AI 里启用 ${choice.model}。` });
      }
    }
    for (const [id, models] of enabled) this.enabled.set(id, models);
    for (const change of body.purposes) this.overrides.set(change.purpose, structuredClone(change.chosen));
    if (body.default !== undefined) this.chosen = body.default;
    this.version += 1;
    return this.view();
  }

  private catalog(): CatalogProvider[] {
    return PROVIDERS.map((item) => ({ id: item.id, name: item.name, connected: this.connected.has(item.id),
      models: item.models }));
  }

  private resolver(): ModelResolver {
    const enabled = Object.fromEntries(this.enabled);
    return new ModelResolver(this.catalog(), { default: this.chosen, overrides: Object.fromEntries(this.overrides),
      enabled }, (providerId, modelId, level) => {
      const found = PROVIDERS.find((item) => item.id === providerId)?.models.find((item) => item.id === modelId);
      return found === undefined ? level : clampToLevels(found.thinkingLevels, level);
    });
  }

  private view(): ListModelProvidersResponse {
    const resolver = this.resolver();
    const providers = PROVIDERS.map((item): ModelProviderView => {
      const connected = this.connected.get(item.id) ?? null;
      return { ...item, models: item.models.map(({ price: _price, ...rest }) => rest), connected,
        account: connected === 'oauth' ? 'me@example.com' : null,
        plan: connected === 'oauth' ? 'plus' : null, keyLast4: connected === 'api_key'
          ? this.keyTails.get(item.id) ?? null : null, enabled: resolver.enabled[item.id] ?? [] };
    });
    const purposes = MODEL_PURPOSES.map(({ id }) => ({ purpose: id,
      chosen: this.overrides.get(id) ?? { model: null, thinking: null }, ...pick(resolver.resolve(id)) }));
    const top = resolver.resolve();
    return structuredClone({ providers, chosen: this.chosen, effective: top.effective,
      version: this.version, purposes, defaultIssue: top.issue });
  }

  private require(providerId: string): FakeProvider {
    const found = PROVIDERS.find((item) => item.id === providerId);
    if (found === undefined) {
      throw new ApiError({ kind: 'invalid', code: 'not_found', status: 404, message: `没有这家模型提供商：${providerId}。` });
    }
    return found;
  }

  private requireLogin(loginId: string): ProviderLoginView {
    const login = this.logins.get(loginId);
    if (login === undefined) {
      throw new ApiError({ kind: 'invalid', code: 'not_found', status: 404, message: '这次登录已经过期了，重新开始。' });
    }
    return login;
  }
}

function pick(resolution: { effective: ModelChoiceView | null; issue: string | null }) {
  return { effective: resolution.effective, issue: resolution.issue };
}
