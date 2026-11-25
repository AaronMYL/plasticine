import type { AnyModel, Api, Credential, Model, ModelsStore, ModelsStoreEntry, Provider, RefreshModelsContext }
  from '@earendil-works/pi-ai';

export const ACCOUNT_MODEL_PROVIDERS: readonly string[] = ['openai', 'openai-codex'];
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

export function isEstimated(model: object): boolean {
  return estimated.has(model);
}

export function modelName(displayName: string | undefined, slug: string): string {
  const raw = displayName?.trim() || slug;
  return raw.replace(/^(GPT-\d+(?:\.\d+)?)-(?=[A-Za-z])/u, '$1 ');
}

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

function family(id: string): { line: string; version: number } | null {
  const match = /^gpt-(\d+(?:\.\d+)?)-([a-z]+)$/u.exec(id);
  return match === null ? null : { line: match[2]!, version: Number(match[1]) };
}

export function baseFor(slug: string, catalog: readonly Model<Api>[]): Model<Api> | null {
  const wanted = family(slug);
  const ranked = catalog.flatMap((model) => {
    const known = family(model.id);
    return known === null ? [] : [{ model, known }];
  }).sort((left, right) => right.known.version - left.known.version);
  return ranked.find((item) => item.known.line === wanted?.line)?.model ?? ranked[0]?.model ?? null;
}

export function estimate(listed: ListedModel, catalog: readonly Model<Api>[], providerId: string): Model<Api> | null {
  const base = baseFor(listed.slug, catalog);
  if (base === null) {
    return null;
  }
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
