import { THINKING_LABELS, THINKING_LEVELS, type ModelChoiceView, type ModelOverride } from './model-providers.ts';
import { providerDisplayName } from './model-names.ts';
import { purposeInfo, requiresImages, type ModelPurpose } from './model-purposes.ts';

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const DEFAULT_THINKING: ThinkingLevel = 'medium';
export const CHEAP_THINKING: ThinkingLevel = 'low';

export interface CatalogModel {
  id: string;
  name: string;
  input: readonly string[];
  thinkingLevels: readonly ThinkingLevel[];
  price: number | null;
}

export interface CatalogProvider {
  id: string;
  name: string;
  connected: boolean;
  models: readonly CatalogModel[];
}

export interface ModelSettings {
  default: ModelChoiceView | null;
  overrides: Partial<Record<ModelPurpose, ModelOverride>>;
  enabled: Readonly<Record<string, readonly string[]>>;
}

export interface Resolution {
  effective: ModelChoiceView | null;
  issue: string | null;
  thinking: ThinkingLevel;
}

export type ClampThinking = (provider: string, model: string, level: ThinkingLevel) => ThinkingLevel;

export function clampToLevels(levels: readonly ThinkingLevel[], level: ThinkingLevel): ThinkingLevel {
  if (levels.includes(level)) {
    return level;
  }
  const index = THINKING_LEVELS.indexOf(level);
  const higher = THINKING_LEVELS.slice(index + 1).find((item) => levels.includes(item));
  if (higher !== undefined) {
    return higher;
  }
  const lower = THINKING_LEVELS.slice(0, index).reverse().find((item) => levels.includes(item));
  return lower ?? levels[0] ?? 'off';
}

interface Ref {
  provider: string;
  model: string;
}

function sameRef(a: Ref | null | undefined, b: Ref | null | undefined): boolean {
  return a != null && b != null && a.provider === b.provider && a.model === b.model;
}

function legacyDefault(catalog: readonly CatalogProvider[], settings: ModelSettings): Ref | null {
  const chosen = settings.default;
  const provider = catalog.find((item) => item.id === chosen?.provider);
  if (chosen !== null && provider?.connected === true && provider.models.some((item) => item.id === chosen.model)) {
    return chosen;
  }
  const first = catalog.find((item) => item.connected && item.models.length > 0);
  const model = first?.models[0];
  return first === undefined || model === undefined ? null : { provider: first.id, model: model.id };
}

export function enabledSets(catalog: readonly CatalogProvider[], settings: ModelSettings):
  Record<string, string[]> {
  const used: Ref[] = [
    ...(settings.default === null ? [] : [settings.default]),
    ...Object.values(settings.overrides).flatMap((item) => item?.model == null ? [] : [item.model]),
  ];
  const legacy = legacyDefault(catalog, settings);
  if (legacy !== null) {
    used.push(legacy);
  }
  const sets: Record<string, string[]> = {};
  for (const provider of catalog) {
    const stored = settings.enabled[provider.id];
    const wanted = stored ?? used.filter((ref) => ref.provider === provider.id).map((ref) => ref.model);
    sets[provider.id] = provider.models.filter((model) => wanted.includes(model.id)).map((model) => model.id);
  }
  return sets;
}

export class ModelResolver {
  readonly enabled: Record<string, string[]>;
  readonly #catalog: readonly CatalogProvider[];
  readonly #settings: ModelSettings;
  readonly #clamp: ClampThinking;
  readonly #cache = new Map<string, Resolution>();

  constructor(catalog: readonly CatalogProvider[], settings: ModelSettings, clamp: ClampThinking) {
    this.#catalog = catalog;
    this.#settings = settings;
    this.#clamp = clamp;
    this.enabled = enabledSets(catalog, settings);
  }

  #find(ref: Ref): { provider: CatalogProvider; model: CatalogModel } | null {
    const provider = this.#catalog.find((item) => item.id === ref.provider);
    const model = provider?.models.find((item) => item.id === ref.model);
    return provider === undefined || model === undefined ? null : { provider, model };
  }

  problem(ref: Ref, purpose?: ModelPurpose): string | null {
    const found = this.#find(ref);
    if (found === null) {
      return `没有「${ref.model}」这个模型了`;
    }
    if (!found.provider.connected) {
      return `${providerDisplayName(found.provider)} 已断开`;
    }
    if (!(this.enabled[ref.provider] ?? []).includes(ref.model)) {
      return `${found.model.name} 已取消启用`;
    }
    if (requiresImages(purpose) && !found.model.input.includes('image')) {
      return `${found.model.name} 不能看图`;
    }
    return null;
  }

  #usable(purpose?: ModelPurpose): Ref[] {
    return this.#catalog.flatMap((provider) => provider.models.map((model) => ({ provider: provider.id,
      model: model.id }))).filter((ref) => this.problem(ref, purpose) === null);
  }

  #nameOf(ref: Ref): string {
    const found = this.#find(ref);
    return found === null ? ref.model : `${providerDisplayName(found.provider)} · ${found.model.name}`;
  }

  #none(purpose: ModelPurpose | undefined, thinking: ThinkingLevel): Resolution {
    const connected = this.#catalog.some((item) => item.connected);
    const issue = requiresImages(purpose) ? '还没有启用能看图的模型。'
      : connected ? '还没有启用模型。' : '还没有连接可用模型。';
    return { effective: null, issue, thinking };
  }

  #settle(options: { purpose?: ModelPurpose | undefined; requested: Ref | null; candidates: ReadonlyArray<Ref | null>;
    thinking: ThinkingLevel; explicitThinking: boolean; fallbackNote: (used: Ref) => string }): Resolution {
    const { purpose, requested, thinking } = options;
    const picked = [...options.candidates, ...this.#usable(purpose)]
      .find((ref): ref is Ref => ref !== null && this.problem(ref, purpose) === null);
    if (picked === undefined) {
      return this.#none(purpose, thinking);
    }
    const used = this.#clamp(picked.provider, picked.model, thinking);
    const effective = { provider: picked.provider, model: picked.model, thinking: used };
    if (requested !== null && !sameRef(requested, picked)) {
      const reason = this.problem(requested, purpose) ?? '用不了';
      return { effective, issue: `${reason}，${options.fallbackNote(picked)}。`, thinking };
    }
    if (options.explicitThinking && used !== thinking) {
      const name = this.#find(picked)?.model.name ?? picked.model;
      return { effective, issue: `${name} 的思考档没有「${THINKING_LABELS[thinking]}」，用「${THINKING_LABELS[used]}」。`,
        thinking };
    }
    return { effective, issue: null, thinking };
  }

  resolve(purpose?: ModelPurpose): Resolution {
    const key = purpose ?? '';
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = purpose === undefined ? this.#resolveDefault() : this.#resolvePurpose(purpose);
    this.#cache.set(key, result);
    return result;
  }

  #resolveDefault(): Resolution {
    const chosen = this.#settings.default;
    return this.#settle({ requested: chosen, candidates: [chosen], thinking: chosen?.thinking ?? DEFAULT_THINKING,
      explicitThinking: chosen !== null, fallbackNote: (used) => `暂用 ${this.#nameOf(used)}` });
  }

  cheap(): Resolution {
    const base = this.resolve();
    const effective = base.effective;
    if (effective === null) {
      return base;
    }
    const price = (ref: Ref): number | null => {
      const value = this.#find(ref)?.model.price ?? null;
      return value === null || value <= 0 ? null : value;
    };
    const basePrice = price(effective);
    if (basePrice === null) {
      return base;
    }
    let best: Ref = effective;
    let bestPrice = basePrice;
    for (const ref of this.#usable().filter((item) => item.provider === effective.provider)) {
      const value = price(ref);
      if (value !== null && value < bestPrice) {
        best = ref;
        bestPrice = value;
      }
    }
    return { effective: { ...best, thinking: this.#clamp(best.provider, best.model, CHEAP_THINKING) }, issue: null,
      thinking: CHEAP_THINKING };
  }

  #fallback(fallback: ReturnType<typeof purposeInfo>['fallback']): Resolution {
    if (fallback === 'main' || fallback === 'note_predict') {
      return this.resolve(fallback);
    }
    return fallback === 'cheap' ? this.cheap() : this.resolve();
  }

  #resolvePurpose(purpose: ModelPurpose): Resolution {
    const override = this.#settings.overrides[purpose] ?? { model: null, thinking: null };
    const { fallback, thinking } = purposeInfo(purpose);
    const parent = this.#fallback(fallback);
    const parentRef = parent.effective;
    return this.#settle({ purpose, requested: override.model, candidates: [override.model, parentRef],
      thinking: override.thinking ?? thinking ?? parent.thinking, explicitThinking: override.thinking !== null,
      fallbackNote: (used) => sameRef(used, parentRef) ? '回到默认' : `暂用 ${this.#nameOf(used)}` });
  }
}
