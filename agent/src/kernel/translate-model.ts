// 兼容旧翻译设置接口；选择和执行都转到用途配置，不再保留第二份模型设置真源。
import type { ModelChoiceView, TranslateModelView } from '../../shared/api/index.ts';
import type { ModelSource } from '../lines/index.ts';
import type { KernelModels, KernelModelState } from './models.ts';

export class TranslateModel {
  readonly #models: KernelModels;

  constructor(models: KernelModels, _state: KernelModelState) {
    this.#models = models;
  }

  effective(): ModelChoiceView | null {
    return this.#models.effective('translation');
  }

  view(): TranslateModelView {
    const settings = this.#models.settings();
    const override = settings.purposes.find((item) => item.purpose === 'translation')?.chosen;
    const effective = this.effective();
    const chosen = override?.model === null || override?.model === undefined ? null
      : { ...override.model, thinking: override.thinking ?? this.#models.chosen()?.thinking ?? 'medium' };
    return { chosen, effective, version: settings.version };
  }

  choose(chosen: ModelChoiceView | null, version: number): TranslateModelView {
    // 旧接口没有「启用」这一步：选中的顺手启用，和新设置里的规则一致（只能用启用了的）。
    const enabled = chosen === null ? undefined
      : [{ provider: chosen.provider, models: [...this.#models.enabled()[chosen.provider] ?? [], chosen.model] }];
    this.#models.configure({ version, ...(enabled === undefined ? {} : { enabled }), purposes: [{
      purpose: 'translation', chosen: {
        model: chosen === null ? null : { provider: chosen.provider, model: chosen.model },
        thinking: chosen?.thinking ?? null,
      } }] });
    return this.view();
  }

  source(): ModelSource {
    return {
      current: () => this.#models.current('translation'),
      streamFn: this.#models.streamFn,
      complete: (model, context, options) => this.#models.complete(model, context, options),
    };
  }
}
