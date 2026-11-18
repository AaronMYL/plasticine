// pi-ai 内置的模型目录比上游发布晚：OpenAI 11-17 上线 GPT-6.2 Astra、GPT-6.2 Sol（ChatGPT 订阅和 API 都有），
// pi-ai 最新的 1.5.2（11-10）还没有，上游 main 已经加了（earendil-works/pi 的 packages/ai/catalog/providers/openai.ts、
// openai-codex.ts、families/openai.ts，11-18 看过）。Aaron 11-18 说设置里没有 6.2 可选，这里照上游补上：
// 从同一家同一类的旧型号抄一份（请求方式、思考档位、兼容开关一样），只换名字、价格、上下文。
// 目录里已经有的不补——升级到带 6.2 的 pi-ai 以后这份自动不起作用，可以删掉。

import type { Api, Model, ModelCost, Provider } from '@earendil-works/pi-ai';

interface Addition {
  provider: string;
  /** 从哪一个旧型号抄。 */
  from: string;
  id: string;
  name: string;
  cost: ModelCost;
  contextWindow?: number;
}

/** OpenAI 超过 27.2 万输入 token 的那一档：输入、缓存 2 倍，输出 1.5 倍（上游 withOpenAiLongContextPricing）。 */
function longContext(input: number, output: number, cacheRead: number, cacheWrite: number): ModelCost {
  return { input, output, cacheRead, cacheWrite, tiers: [{ inputTokensAbove: 272_000, input: input * 2,
    output: output * 1.5, cacheRead: cacheRead * 2, cacheWrite: cacheWrite * 2 }] };
}

const ASTRA_COST = longContext(8, 40, 0.4, 10);
const SOL_COST = longContext(2, 10, 0.1, 2.5);

export const CATALOG_ADDITIONS: readonly Addition[] = [
  { provider: 'openai', from: 'gpt-6-astra', id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', cost: ASTRA_COST },
  { provider: 'openai', from: 'gpt-6.1-sol', id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', cost: SOL_COST },
  { provider: 'openai-codex', from: 'gpt-6-astra', id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', cost: ASTRA_COST,
    contextWindow: 272_000 },
  { provider: 'openai-codex', from: 'gpt-6.1-sol', id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', cost: SOL_COST,
    contextWindow: 500_000 },
];

/** 这一家目录里还没有的那几个。 */
function missing(provider: Provider, additions: readonly Addition[]): Model<Api>[] {
  const known = provider.getModels();
  return additions.filter((addition) => addition.provider === provider.id
    && !known.some((model) => model.id === addition.id)).flatMap((addition) => {
    const base = known.find((model) => model.id === addition.from);
    return base === undefined ? [] : [{ ...base, id: addition.id, name: addition.name, cost: addition.cost,
      ...(addition.contextWindow === undefined ? {} : { contextWindow: addition.contextWindow }) }];
  });
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

/** 补上目录里缺的型号；没缺的原样返回。请求照旧交给原来那一家（按型号的请求方式分派）。 */
export function withCatalogAdditions(provider: Provider, additions: readonly Addition[] = CATALOG_ADDITIONS)
  : Provider {
  if (missing(provider, additions).length === 0) {
    return provider;
  }
  const getAllModels = provider.getAllModels;
  return {
    ...provider,
    getModels: () => merged(provider.getModels(), missing(provider, additions)),
    ...(getAllModels === undefined ? {}
      : { getAllModels: () => merged(getAllModels.call(provider), missing(provider, additions)) }),
  };
}
