// 自定义提供商的保存和删除（custom-providers.ts 管怎么做成 pi-ai 提供商，这里管改配置）：
// - 新建给一个 custom- 开头的 id；填了的模型全部启用（他是一个个填进来的，就是要用）；
// - 改的时候新加的模型启用，原来启用着的照旧，删掉的模型自然不再出现；key 不给就沿用；
// - 删除：卸掉这家、清掉 key，选了它的默认模型和各用途回到「跟默认走」。

import { randomUUID } from 'node:crypto';
import { CUSTOM_PROVIDER_PREFIX, type SaveCustomProviderRequest } from '../../shared/api/custom-providers.ts';
import type { StateService } from '../state/index.ts';
import { readCustomProviders, writeCustomProviders, type CustomProviderConfig } from './custom-providers.ts';
import { KernelModelError, type KernelModels } from './models.ts';

type CustomInput = Omit<SaveCustomProviderRequest, 'requestId'>;
type SettingsState = Pick<StateService, 'kernelSettings'>;

function checkedUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (error) {
    if (error instanceof TypeError) throw new KernelModelError('invalid', 'Base URL 不是一个网址。');
    throw error;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new KernelModelError('invalid', 'Base URL 要以 http:// 或 https:// 开头。');
  }
  return trimmed;
}

function cleanModels(models: readonly string[]): string[] {
  const cleaned = [...new Set(models.map((model) => model.trim()).filter((model) => model !== ''))];
  if (cleaned.length === 0) throw new KernelModelError('invalid', '至少填一个模型名。');
  return cleaned;
}

/** 保存一家自定义提供商，回它的 id。 */
export async function saveCustomProvider(kernel: KernelModels, state: SettingsState,
  input: CustomInput): Promise<string> {
  const configs = readCustomProviders(state);
  const before = input.id === null ? undefined : configs.find((config) => config.id === input.id);
  if (input.id !== null && before === undefined) {
    throw new KernelModelError('not_found', '没有这家自定义提供商。');
  }
  const name = input.name.trim();
  if (name === '') throw new KernelModelError('invalid', '名称不能空着。');
  const config: CustomProviderConfig = {
    id: before?.id ?? `${CUSTOM_PROVIDER_PREFIX}${randomUUID().slice(0, 8)}`,
    name, protocol: input.protocol, baseUrl: checkedUrl(input.baseUrl), models: cleanModels(input.models),
  };
  const hasKey = kernel.credentials.connectedType(config.id) !== null;
  if (input.apiKey !== undefined || !hasKey) {
    const key = (input.apiKey ?? '').trim();
    await kernel.credentials.modify(config.id, async () => ({ type: 'api_key', key }));
  }
  writeCustomProviders(state, before === undefined ? [...configs, config]
    : configs.map((item) => (item.id === config.id ? config : item)));
  kernel.register(config);
  const wasEnabled = kernel.enabled()[config.id] ?? [];
  const added = config.models.filter((model) => !(before?.models ?? []).includes(model));
  const enabled = config.models.filter((model) => wasEnabled.includes(model) || added.includes(model));
  kernel.configure({ version: kernel.settings().version, purposes: [],
    enabled: [{ provider: config.id, models: enabled }] });
  return config.id;
}

/** 删掉一家自定义提供商。 */
export async function removeCustomProvider(kernel: KernelModels, state: SettingsState, id: string): Promise<void> {
  const configs = readCustomProviders(state);
  if (!configs.some((config) => config.id === id)) {
    throw new KernelModelError('not_found', '没有这家自定义提供商。');
  }
  const settings = kernel.settings();
  const chosen = kernel.chosen();
  kernel.configure({
    version: settings.version,
    ...(chosen?.provider === id ? { default: null } : {}),
    purposes: settings.purposes.flatMap(({ purpose, chosen: override }) => (override.model?.provider === id
      ? [{ purpose, chosen: { model: null, thinking: override.thinking } }] : [])),
    enabled: [{ provider: id, models: [] }],
  });
  writeCustomProviders(state, configs.filter((config) => config.id !== id));
  kernel.models.deleteProvider(id);
  await kernel.credentials.delete(id);
}

/** 测试连接时沿用存着的 key（表单里没改 key）。 */
export async function storedCustomKey(kernel: KernelModels, id: string): Promise<string> {
  const credential = await kernel.credentials.read(id);
  return credential?.type === 'api_key' ? credential.key ?? '' : '';
}
