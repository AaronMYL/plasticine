// 自动拉型号清单（11-18 Aaron 定）：pi-ai 自带的目录比发布晚（OpenAI 11-17 出了 GPT-6.2，pi-ai 1.5.2 里没有），改成
// 问账号能用哪些型号。ChatGPT 订阅登录的两家都有列表接口（11-18 用线上的登录实测过）：
// - OpenAI（Sign in with ChatGPT）：GET https://api.openai.com/v1/models，回 { models: [{ slug, display_name,
//   context_window, visibility, … }] }；用 API key 连的回的是另一种格式，不拉。
// - ChatGPT（Codex）：GET https://chatgpt.com/backend-api/codex/models，同样的格式，要带账号 id。
// 规矩：pi-ai 目录里有的一律用 pi-ai 的资料，拉来的只补它没有的；补的照同一家同系列的旧型号（请求方式、思考档位、
// 价格），上下文用接口给的（OpenAI 那家照 pi-ai 的做法封在旧型号的上限），标「价格照旧型号估的」（isEstimated）。
// 用 pi-ai 的动态目录：Models.refresh() 调 refreshModels，OAuth 令牌由 pi-ai 先刷新；拉到的存进库（models-store.ts），
// 重启后不联网也在。

import type { AnyModel, Api, Credential, Model, ModelsStore, ModelsStoreEntry, Provider, RefreshModelsContext }
  from '@earendil-works/pi-ai';

/** 拉清单的两家。 */
export const ACCOUNT_MODEL_PROVIDERS: readonly string[] = ['openai', 'openai-codex'];
/** 多久联网问一次（没到就用存下的）。 */
export const ACCOUNT_MODELS_FRESH_MS = 6 * 60 * 60 * 1000;
const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models?client_version=0.166.0';
const FETCH_TIMEOUT_MS = 20_000;

export interface ListedModel {
  slug: string;
  name: string;
  contextWindow: number | null;
}

type Fetch = typeof globalThis.fetch;

const estimated = new WeakSet<object>();

/** 这个型号是拉来补的（价格照旧型号估的）。 */
export function isEstimated(model: object): boolean {
  return estimated.has(model);
}

/** 「GPT-6.2-Astra」→「GPT-6.2 Astra」（和 pi-ai 目录的叫法一样）。 */
export function modelName(displayName: string | undefined, slug: string): string {
  const raw = displayName?.trim() || slug;
  return raw.replace(/^(GPT-\d+(?:\.\d+)?)-(?=[A-Za-z])/u, '$1 ');
}

/** 接口回的列表：只要看得见的（visibility 不是 hide）。 */
export function parseListed(body: unknown): ListedModel[] {
  const models: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'models') : undefined;
  if (!Array.isArray(models)) {
    return [];
  }
  return models.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const slug: unknown = Reflect.get(entry, 'slug');
    const visibility: unknown = Reflect.get(entry, 'visibility');
    const context: unknown = Reflect.get(entry, 'context_window');
    const display: unknown = Reflect.get(entry, 'display_name');
    if (typeof slug !== 'string' || slug === '' || visibility === 'hide') return [];
    return [{ slug, name: modelName(typeof display === 'string' ? display : undefined, slug),
      contextWindow: typeof context === 'number' && context > 0 ? context : null }];
  });
}

/** 型号的系列：gpt-6.2-astra → astra；版本：6.2。 */
function family(id: string): { line: string; version: number } | null {
  const match = /^gpt-(\d+(?:\.\d+)?)-([a-z]+)$/u.exec(id);
  return match === null ? null : { line: match[2]!, version: Number(match[1]) };
}

/** 照哪个旧型号补：同系列里版本最高的；没有同系列的就用目录里版本最高的那个。 */
export function baseFor(slug: string, catalog: readonly Model<Api>[]): Model<Api> | null {
  const wanted = family(slug);
  const ranked = catalog.flatMap((model) => {
    const known = family(model.id);
    return known === null ? [] : [{ model, known }];
  }).sort((left, right) => right.known.version - left.known.version);
  return ranked.find((item) => item.known.line === wanted?.line)?.model ?? ranked[0]?.model ?? null;
}

/** 从接口回的一项补出一个型号；照的旧型号找不到就不补。 */
export function estimate(listed: ListedModel, catalog: readonly Model<Api>[], providerId: string): Model<Api> | null {
  const base = baseFor(listed.slug, catalog);
  if (base === null) {
    return null;
  }
  // OpenAI 那家照 pi-ai：直连默认封在短上下文那一档（超过 27.2 万按更贵的价格算）。
  const contextWindow = providerId === 'openai' || listed.contextWindow === null ? base.contextWindow
    : listed.contextWindow;
  const model: Model<Api> = { ...base, id: listed.slug, name: listed.name, contextWindow };
  estimated.add(model);
  return model;
}

function accountId(credential: Credential): string | null {
  const stored: unknown = Reflect.get(credential, 'accountId');
  if (typeof stored === 'string' && stored !== '') return stored;
  if (credential.type !== 'oauth') return null;
  try {
    const part = credential.access.split('.')[1] ?? '';
    const payload: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    const claim: unknown = typeof payload === 'object' && payload !== null
      ? Reflect.get(payload, 'https://api.openai.com/auth') : undefined;
    const id: unknown = typeof claim === 'object' && claim !== null
      ? Reflect.get(claim, 'chatgpt_account_id') : undefined;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/** 问账号能用哪些型号；只认订阅登录（OAuth），别的连法回 null（不动存下的）。 */
export async function fetchListed(providerId: string, baseUrl: string, credential: Credential | undefined,
  signal: AbortSignal, fetcher: Fetch = globalThis.fetch): Promise<ListedModel[] | null> {
  if (credential?.type !== 'oauth') {
    return null;
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${credential.access}` };
  let url = `${baseUrl.replace(/\/+$/u, '')}/models`;
  if (providerId === 'openai-codex') {
    url = CODEX_MODELS_URL;
    headers['chatgpt-account-id'] = accountId(credential) ?? '';
    headers['originator'] = 'pi';
  }
  const response = await fetcher(url, { headers,
    signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) });
  if (!response.ok) {
    throw new Error(`${providerId} 的型号列表回了 ${String(response.status)}`);
  }
  return parseListed(await response.json());
}

/** 按名字插进目录里该在的位置（pi-ai 的目录按名字排；出图默认拿 Codex 目录的第一个，不能变）。 */
function merged<T extends { id: string }>(models: readonly T[], extra: readonly T[]): T[] {
  const out = [...models];
  for (const model of extra) {
    const at = out.findIndex((each) => each.id > model.id);
    out.splice(at < 0 ? out.length : at, 0, model);
  }
  return out;
}

export interface AccountModelsOptions {
  fetch?: Fetch;
  now?: () => number;
}

/**
 * 给一家套上「拉清单」：目录照旧，补上账号列出来、目录里没有的。只套 ACCOUNT_MODEL_PROVIDERS 里的；别的原样返回。
 */
export function withAccountModels(provider: Provider, options: AccountModelsOptions = {}): Provider {
  if (!ACCOUNT_MODEL_PROVIDERS.includes(provider.id)) {
    return provider;
  }
  const now = options.now ?? Date.now;
  let extra: Model<Api>[] = [];
  const missing = (): Model<Api>[] => {
    const known = new Set(provider.getModels().map((model) => model.id));
    return extra.filter((model) => !known.has(model.id));
  };
  const keep = (models: readonly AnyModel[]): Model<Api>[] => models.flatMap((model) => {
    if (!('api' in model) || ('type' in model && model.type !== undefined && model.type !== 'chat')) return [];
    const copy = { ...(model as Model<Api>) };
    estimated.add(copy);
    return [copy];
  });
  const getAllModels = provider.getAllModels;
  return {
    ...provider,
    getModels: () => merged(provider.getModels(), missing()),
    getAllModels: () => merged<NonNullable<ReturnType<NonNullable<Provider['getAllModels']>>>[number]>(
      getAllModels?.call(provider) ?? provider.getModels(), missing()),
    async refreshModels(context: RefreshModelsContext): Promise<void> {
      if (context.stored !== undefined) {
        const restored = keep(context.stored.models);
        await context.publish({ update: () => { extra = restored; } });
        const checkedAt = context.stored.checkedAt;
        const fresh = checkedAt !== undefined && now() - checkedAt < ACCOUNT_MODELS_FRESH_MS;
        if (fresh && context.force !== true) return;
      }
      if (!context.allowNetwork || context.signal.aborted) {
        return;
      }
      const listed = await fetchListed(provider.id, context.baseUrl ?? provider.baseUrl ?? '', context.credential,
        context.signal, options.fetch);
      if (listed === null || context.signal.aborted) {
        return;
      }
      const catalog = provider.getModels();
      const known = new Set(catalog.map((model) => model.id));
      const found = listed.filter((item) => !known.has(item.slug))
        .flatMap((item) => estimate(item, catalog, provider.id) ?? []);
      await context.publish({ persist: { models: found, checkedAt: now() }, update: () => { extra = found; } });
    },
  };
}

type SettingsState = { kernelSettings: { get(key: string): unknown; set(key: string, value: unknown): void } };

/** pi-ai 的型号目录存储，存在库里 kernel_settings 的 account_models:<家> 下（重启后不联网也有）。 */
export class SettingsModelsStore implements ModelsStore {
  readonly #state: SettingsState;

  constructor(state: SettingsState) {
    this.#state = state;
  }

  async read(providerId: string): Promise<ModelsStoreEntry | undefined> {
    const value: unknown = this.#state.kernelSettings.get(`account_models:${providerId}`);
    const models: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'models') : undefined;
    if (!Array.isArray(models)) {
      return undefined;
    }
    const checkedAt: unknown = Reflect.get(value as object, 'checkedAt');
    return { models: models as AnyModel[], ...(typeof checkedAt === 'number' ? { checkedAt } : {}) };
  }

  async write(providerId: string, entry: ModelsStoreEntry): Promise<void> {
    this.#state.kernelSettings.set(`account_models:${providerId}`, { models: entry.models,
      ...(entry.checkedAt === undefined ? {} : { checkedAt: entry.checkedAt }) });
  }

  async delete(providerId: string): Promise<void> {
    this.#state.kernelSettings.set(`account_models:${providerId}`, null);
  }
}
