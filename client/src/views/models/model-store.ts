// 模型连接的数据（新内核 /v2/model-providers…，2026-11-05 他定：提供商一律平级）：哪几家、连没连、选的默认模型和实际在用的。
// 设置 · AI、连接模型那一页、输入框里的「GPT-5.5 · 高」都读这一份；改了（登上、填 key、断开、选模型）整份换成回答里的。

import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { providerDisplayName, THINKING_LABELS } from '../../api/shared.ts';
import type { ListModelProvidersResponse, ModelChoiceView, ModelOverride, ModelProviderView,
  ModelPurpose, SaveModelConfigRequest } from '../../api/shared.ts';
import { Store } from '../../state/store.ts';

export interface ModelsData {
  loaded: boolean;
  error: string | null;
  value: ListModelProvidersResponse | null;
}

export { THINKING_LABELS } from '../../api/shared.ts';

// 列表上的标记：常用的几家（名字在 shared 的 PROVIDER_DISPLAY_NAMES，服务端写出错原因也用那份）先列，
// 其余收在「更多」里（提供商一律平级，只是这几家最常用）。
const MARKS: Readonly<Record<string, string>> = {
  openai: 'G',
  anthropic: 'C',
  deepseek: 'D',
  'moonshotai-cn': 'K',
  'qwen-token-plan-cn': '通',
  zai: '智',
  'minimax-cn': 'M',
};

export const FEATURED_PROVIDERS: readonly string[] = Object.keys(MARKS);

export function providerName(provider: Pick<ModelProviderView, 'id' | 'name'>): string {
  return providerDisplayName(provider);
}

export function providerMark(provider: Pick<ModelProviderView, 'id' | 'name'>): string {
  return MARKS[provider.id] ?? (provider.name.trim()[0] ?? '·').toUpperCase();
}

/** 先列常用的几家（连上了的不管是哪家都在前面），其余按服务端的顺序收进「更多」。 */
export function arrangeProviders(providers: readonly ModelProviderView[]): {
  featured: ModelProviderView[]; more: ModelProviderView[];
} {
  const featured = providers.filter((item) => item.connected !== null || FEATURED_PROVIDERS.includes(item.id));
  const order = (item: ModelProviderView): number => {
    const index = FEATURED_PROVIDERS.indexOf(item.id);
    return index < 0 ? FEATURED_PROVIDERS.length : index;
  };
  featured.sort((a, b) => order(a) - order(b));
  return { featured, more: providers.filter((item) => !featured.includes(item)) };
}

/** 「GPT-5.5 · 高」：模型名 · 推理档；没有可用的模型时是 null。 */
export function choiceLabel(value: ListModelProvidersResponse | null, purpose?: ModelPurpose): string | null {
  const choice = purpose === undefined ? value?.effective ?? null
    : value?.purposes.find((item) => item.purpose === purpose)?.effective ?? null;
  if (choice === null) {
    return null;
  }
  const provider = value?.providers.find((item) => item.id === choice.provider);
  const model = provider?.models.find((item) => item.id === choice.model);
  return `${model?.name ?? choice.model} · ${THINKING_LABELS[choice.thinking]}`;
}

/** 「ChatGPT · GPT-5.5」：哪一家 · 哪个模型（设置 · 系统的运行情况）。 */
export function choiceName(value: ListModelProvidersResponse | null): string | null {
  const choice = value?.effective ?? null;
  if (choice === null) {
    return null;
  }
  const provider = value?.providers.find((item) => item.id === choice.provider);
  const model = provider?.models.find((item) => item.id === choice.model)?.name ?? choice.model;
  return provider === undefined ? model : `${providerName(provider)} · ${model}`;
}

const NOT_READ = '模型设置还没读完，请稍后再试。';

export class ModelStore {
  readonly store = new Store<ModelsData>({ loaded: false, error: null, value: null });
  private readonly api: PlasticineApi;

  constructor(api: PlasticineApi) {
    this.api = api;
  }

  async reload(): Promise<void> {
    try {
      const value = await this.api.modelProviders.list();
      this.store.set({ loaded: true, error: null, value });
    } catch (cause) {
      this.store.set((data) => ({ ...data, loaded: true, error: errorText(cause) }));
    }
  }

  /** 一家连上 / 断开 / 选模型之后的整份。 */
  apply(value: ListModelProvidersResponse): void {
    this.store.set({ loaded: true, error: null, value });
  }

  async setKey(providerId: string, apiKey: string): Promise<string | null> {
    return this.write(() => this.api.modelProviders.setKey(providerId, createRequestId(), apiKey));
  }

  async logout(providerId: string): Promise<string | null> {
    return this.write(() => this.api.modelProviders.logout(providerId, createRequestId()));
  }

  async choose(choice: ModelChoiceView): Promise<string | null> {
    return this.write(() => this.api.modelProviders.setDefault({ requestId: createRequestId(), ...choice }));
  }

  async save(input: Omit<SaveModelConfigRequest, 'requestId'>): Promise<string | null> {
    return this.write(() => this.api.modelProviders.saveConfig({ requestId: createRequestId(), ...input }));
  }

  async choosePurpose(purpose: ModelPurpose, chosen: ModelOverride): Promise<string | null> {
    const value = this.store.get().value;
    if (value === null) return NOT_READ;
    return this.saveFresh({ version: value.version, purposes: [{ purpose, chosen }] });
  }

  /** 几个功能合成的一行（第13批设置 · AI 分组）：一起改成同一个。 */
  async choosePurposes(purposes: readonly ModelPurpose[], chosen: ModelOverride): Promise<string | null> {
    const value = this.store.get().value;
    if (value === null) return NOT_READ;
    return this.saveFresh({ version: value.version, purposes: purposes.map((purpose) => ({ purpose, chosen })) });
  }

  /** 设置 · AI 的「默认」那一行：全局默认（模型和思考都要有）。 */
  async chooseDefault(choice: ModelChoiceView): Promise<string | null> {
    const value = this.store.get().value;
    if (value === null) return NOT_READ;
    return this.saveFresh({ version: value.version, default: choice, purposes: [] });
  }

  /** 一家启用哪几个模型（整份换掉）。 */
  async setEnabled(providerId: string, models: readonly string[]): Promise<string | null> {
    const value = this.store.get().value;
    if (value === null) return NOT_READ;
    return this.saveFresh({ version: value.version, purposes: [], enabled: [{ provider: providerId,
      models: [...models] }] });
  }

  /** 选了马上存；别处刚改过（版本对不上）就重新读一份，让界面回到真实状态，再说一句。 */
  private async saveFresh(input: Omit<SaveModelConfigRequest, 'requestId'>): Promise<string | null> {
    const problem = await this.save(input);
    if (problem !== null) {
      await this.reload();
    }
    return problem;
  }

  /** 成了回 null，没成回一句原因（界面就地说）。 */
  private async write(work: () => Promise<ListModelProvidersResponse>): Promise<string | null> {
    try {
      this.apply(await work());
      return null;
    } catch (cause) {
      return errorText(cause);
    }
  }
}
