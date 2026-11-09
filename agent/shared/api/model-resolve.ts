// 每个用途实际用哪个模型、哪档思考：服务端（kernel/models.ts）和客户端的假接口用同一份规则。
// 2026-11-07《优化清单》第 13 条（用户 11-06 定）：每家先选启用哪几个模型，没启用的不出现在任何选择器里；
// 选到的模型后来被取消启用、或那家断开了，这个用途回到它的默认，那一行写一句原因（配置不改写，重新启用就回来）。
//
// 一家没设过启用哪几个时，默认启用这家现在被用到的模型（全局默认、各用途单独选的、以及以前「默认没选或用不了时
// 退到第一家连着的第一个模型」那一个），保证升级后现有配置照常可用。

import { THINKING_LABELS, THINKING_LEVELS, type ModelChoiceView, type ModelOverride } from './model-providers.ts';
import { providerDisplayName } from './model-names.ts';
import { purposeInfo, requiresImages, type ModelPurpose } from './model-purposes.ts';

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

// 没选过推理档时用中档：够用、不太费额度。
export const DEFAULT_THINKING: ThinkingLevel = 'medium';
// 心跳、做梦跟便宜的模型时用低档：它们跑得勤，花得少要紧。
export const CHEAP_THINKING: ThinkingLevel = 'low';

export interface CatalogModel {
  id: string;
  name: string;
  input: readonly string[];
  thinkingLevels: readonly ThinkingLevel[];
  /** 目录价（每百万 token 输入加输出）；不知道是 null。 */
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
  /** 存过启用集合的那几家；没存过的按「现在被用到的」算。 */
  enabled: Readonly<Record<string, readonly string[]>>;
}

export interface Resolution {
  effective: ModelChoiceView | null;
  /** 只有出错才有：选的模型用不了、所选思考档不支持。 */
  issue: string | null;
  /** 这一层要的思考档（夹到模型支持的档之前），跟它的用途从这里继承。 */
  thinking: ThinkingLevel;
}

export type ClampThinking = (provider: string, model: string, level: ThinkingLevel) => ThinkingLevel;

/** 照 pi-ai 的 clampThinkingLevel：支持就用；不支持先往高找，再往低找。服务端直接用 pi 的，测试核对两边一致。 */
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

/** 以前的默认解析：选的那家连着就用它，否则第一家连着的第一个模型。 */
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

/** 每家启用的模型 id（照目录顺序）：存过的照存的，没存过的是这家现在被用到的。 */
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

  /** 这个模型这个用途用不了的原因；能用是 null。 */
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
      return { effective, issue: `${name} 不支持「${THINKING_LABELS[thinking]}」思考，用「${THINKING_LABELS[used]}」。`,
        thinking };
    }
    return { effective, issue: null, thinking };
  }

  /** 全局默认（purpose 不给）或某个用途。 */
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

  /** 心跳、做梦没单独设时：默认那一家里已启用、目录价最低的；看不出价钱就跟默认。 */
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

  #resolvePurpose(purpose: ModelPurpose): Resolution {
    const override = this.#settings.overrides[purpose] ?? { model: null, thinking: null };
    const { fallback, thinking } = purposeInfo(purpose);
    const parent = fallback === 'main' ? this.resolve('main') : fallback === 'cheap' ? this.cheap() : this.resolve();
    const parentRef = parent.effective;
    return this.#settle({ purpose, requested: override.model, candidates: [override.model, parentRef],
      thinking: override.thinking ?? thinking ?? parent.thinking, explicitThinking: override.thinking !== null,
      fallbackNote: (used) => sameRef(used, parentRef) ? '回到默认' : `暂用 ${this.#nameOf(used)}` });
  }
}
