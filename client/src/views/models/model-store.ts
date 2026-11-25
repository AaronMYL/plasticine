import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import {
  providerDisplayName, THINKING_LABELS, type ListModelProvidersResponse, type ModelChoiceView, type ModelOverride,
  type ModelProviderView, type ModelPurpose, type SaveCustomProviderRequest, type SaveModelConfigRequest,
  type TestModelConnectionRequest, type TestModelConnectionResponse,
} from '../../api/shared.ts';
import { Store } from '../../state/store.ts';

export interface ModelsData {
  loaded: boolean;
  error: string | null;
  value: ListModelProvidersResponse | null;
}

export { THINKING_LABELS } from '../../api/shared.ts';

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

  async choosePurposes(purposes: readonly ModelPurpose[], chosen: ModelOverride): Promise<string | null> {
    const value = this.store.get().value;
    if (value === null) return NOT_READ;
    return this.saveFresh({ version: value.version, purposes: purposes.map((purpose) => ({ purpose, chosen })) });
  }

  async chooseDefault(choice: ModelChoiceView): Promise<string | null> {
    const value = this.store.get().value;
    if (value === null) return NOT_READ;
    return this.saveFresh({ version: value.version, default: choice, purposes: [] });
  }

  async setEnabled(providerId: string, models: readonly string[]): Promise<string | null> {
    const value = this.store.get().value;
    if (value === null) return NOT_READ;
    return this.saveFresh({ version: value.version, purposes: [], enabled: [{ provider: providerId,
      models: [...models] }] });
  }

  async saveCustom(input: Omit<SaveCustomProviderRequest, 'requestId'>):
    Promise<{ problem: string | null; id: string | null }> {
    const before = new Set((this.store.get().value?.providers ?? []).map((item) => item.id));
    try {
      const value = await this.api.modelProviders.saveCustom({ requestId: createRequestId(), ...input });
      this.apply(value);
      const fresh = value.providers.find((item) => item.custom !== null && !before.has(item.id));
      return { problem: null, id: input.id ?? fresh?.id ?? null };
    } catch (cause) {
      return { problem: errorText(cause), id: null };
    }
  }

  async removeCustom(providerId: string): Promise<string | null> {
    return this.write(() => this.api.modelProviders.removeCustom(providerId, createRequestId()));
  }

  async testConnection(input: Omit<TestModelConnectionRequest, 'requestId'>):
    Promise<TestModelConnectionResponse | string> {
    try {
      return await this.api.modelProviders.testConnection({ requestId: createRequestId(), ...input });
    } catch (cause) {
      return errorText(cause);
    }
  }

  private async saveFresh(input: Omit<SaveModelConfigRequest, 'requestId'>): Promise<string | null> {
    const problem = await this.save(input);
    if (problem !== null) {
      await this.reload();
    }
    return problem;
  }

  private async write(work: () => Promise<ListModelProvidersResponse>): Promise<string | null> {
    try {
      this.apply(await work());
      return null;
    } catch (cause) {
      return errorText(cause);
    }
  }
}
