// 编辑主线、编辑队友里的「模型」（第13批设计稿 Editor：一格写模型名，右边浅色写哪一家或实际在用的）。
// 主线：点开是共用的选模型弹层，选的先留在弹框里，「保存修改」时才改主线的模型（和设置 · AI「主线」那一行是同一项）。
// 队友：跟主线一样，或者用某一项功能配好的模型（原来「模型配置」那一栏的几项）。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MODEL_PURPOSES, THINKING_LABELS, type ListModelProvidersResponse, type ModelPurpose }
  from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { useStore } from '../../state/use-store.ts';
import { ModelChooserPopover, type ChooserChange } from '../models/model-chooser.tsx';
import { choiceLabel, providerName } from '../models/model-store.ts';
import './model-field.css';

function useModels(): ListModelProvidersResponse | null {
  const live = useLive();
  const data = useStore(live.models.store);
  useEffect(() => {
    if (!data.loaded) void live.models.reload();
  }, [data.loaded, live.models]);
  return data.value;
}

/** 弹框里选了还没存的，当成已经选上来显示（勾在哪、思考档）。 */
export function withMainChoice(value: ListModelProvidersResponse, pending: ChooserChange | null):
  ListModelProvidersResponse {
  if (pending === null) return value;
  return { ...value, purposes: value.purposes.map((item) => item.purpose !== 'main' ? item : { ...item,
    chosen: { model: pending.model, thinking: pending.thinking },
    effective: pending.model === null ? value.effective : { ...pending.model,
      thinking: pending.thinking ?? item.effective?.thinking ?? 'medium' } }) };
}

/** 主线那一格：模型名（分思考档的带上档位）+ 哪一家；跟默认时写「跟默认」+ 主线实际在用的（思考档可能单独设过）。 */
export function mainModelText(value: ListModelProvidersResponse): { name: string; meta: string } {
  const view = value.purposes.find((item) => item.purpose === 'main');
  const chosen = view?.chosen.model ?? null;
  if (chosen === null) return { name: '跟默认', meta: choiceLabel(value, 'main') ?? '先连接模型' };
  const provider = value.providers.find((item) => item.id === chosen.provider);
  const model = provider?.models.find((item) => item.id === chosen.model);
  const thinking = view?.effective?.thinking ?? null;
  const levels = model?.thinkingLevels.length ?? 0;
  return { name: `${model?.name ?? chosen.model}${levels <= 1 || thinking === null ? ''
    : ` · ${THINKING_LABELS[thinking]}`}`, meta: provider === undefined ? '' : providerName(provider) };
}

export function MainModelField({ pending, onPick }: { pending: ChooserChange | null;
  onPick: (change: ChooserChange) => void }): ReactNode {
  const value = useModels();
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const shown = value === null ? null : withMainChoice(value, pending);
  const text = shown === null ? { name: '正在读…', meta: '' } : mainModelText(shown);
  return (
    <div className="model-field">
      <span className="model-field-label" id="main-model-label">模型</span>
      <button ref={button} type="button" className="model-field-box" disabled={shown === null}
        aria-haspopup="dialog" aria-expanded={anchor !== null} aria-labelledby="main-model-label main-model-value"
        onClick={(event) => setAnchor(anchor === null ? anchorOf(event.currentTarget) : null)}>
        <span id="main-model-value" className="model-field-name">{text.name}</span>
        <span className="model-field-meta">{text.meta}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {anchor === null || shown === null ? null : (
        <ModelChooserPopover anchor={anchor} label="主线用的模型" align="start" trigger={button} value={shown}
          purpose="main" onChoose={onPick} onClose={() => setAnchor(null)} />
      )}
    </div>
  );
}

export function MateModelField({ purpose, onChange }: { purpose: ModelPurpose | null;
  onChange: (purpose: ModelPurpose | null) => void }): ReactNode {
  const value = useModels();
  // 「主线」那一项和「跟主线一样」是一回事，只留后者。
  const own = purpose === 'main' ? null : purpose;
  const label = MODEL_PURPOSES.find((item) => item.id === own)?.label ?? own;
  const name = own === null ? '跟主线一样' : `和「${label}」一样`;
  return (
    <div className="model-field">
      <label className="model-field-label" htmlFor="mate-model">模型</label>
      <div className="model-field-box">
        <span className="model-field-name" aria-hidden="true">{name}</span>
        <span className="model-field-meta">{value === null ? '' : choiceLabel(value, own ?? 'main') ?? ''}</span>
        <Icon name="chevron-down" size={16} />
        <select id="mate-model" className="model-field-select" value={own ?? ''}
          onChange={(event) => onChange((event.target.value || null) as ModelPurpose | null)}>
          <option value="">跟主线一样</option>
          {MODEL_PURPOSES.filter((item) => item.id !== 'main').map((item) => (
            <option key={item.id} value={item.id}>和「{item.label}」一样</option>
          ))}
        </select>
      </div>
    </div>
  );
}
