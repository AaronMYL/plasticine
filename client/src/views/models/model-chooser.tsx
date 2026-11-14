// 选模型（《优化清单》第 13 条，设计稿 Settings-AI 的弹层）：设置 · AI 每一行、对话框的模型按钮、翻译菜单三处共用。
// 顶上搜模型；按提供商分组，只列连着且启用了的（没连的收在设置的「添加提供商」里）；底下按这个模型真支持的档位选思考。
// 选了马上存成这个用途的默认，不影响别的用途。

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import {
  clampToLevels, purposeInfo, requiresImages, THINKING_LABELS,
  type ListModelProvidersResponse, type ModelOverride, type ModelPurpose, type ThinkingLevel,
} from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { Popover, type PopoverAnchor } from '../../shell/popover.tsx';
import { providerName } from './model-store.ts';
import './model-chooser.css';

/** 选了什么：purpose 为 null 时是全局默认（模型和思考都得有）。 */
export interface ChooserChange {
  model: ModelOverride['model'];
  thinking: ThinkingLevel | null;
}

export interface ChooserProps {
  value: ListModelProvidersResponse;
  /** null 是全局默认。 */
  purpose: ModelPurpose | null;
  onChoose: (change: ChooserChange) => void;
}

interface Option {
  key: string;
  provider: string;
  model: string;
  name: string;
  group: string;
  levels: readonly ThinkingLevel[];
}

const keyOf = (ref: { provider: string; model: string } | null | undefined): string =>
  ref == null ? '' : `${ref.provider}/${ref.model}`;

/** 「跟默认」「跟主线」「跟续写」：没单独设时跟谁。 */
export function inheritLabel(purpose: ModelPurpose): string {
  const { fallback } = purposeInfo(purpose);
  return fallback === 'main' ? '跟主线' : fallback === 'note_predict' ? '跟续写' : '跟默认';
}

export function chooserOptions(value: ListModelProvidersResponse, purpose: ModelPurpose | null): Option[] {
  return value.providers.filter((provider) => provider.connected !== null).flatMap((provider) => provider.models
    .filter((model) => provider.enabled.includes(model.id))
    .filter((model) => !requiresImages(purpose ?? undefined) || model.input.includes('image'))
    .map((model) => ({ key: `${provider.id}/${model.id}`, provider: provider.id, model: model.id, name: model.name,
      group: providerName(provider), levels: model.thinkingLevels })));
}

/** 这一行现在选着的（单独设的或跟着的）和它实际在用的。 */
function currentOf(value: ListModelProvidersResponse, purpose: ModelPurpose | null): ChooserChange & {
  effective: { provider: string; model: string; thinking: ThinkingLevel } | null;
} {
  if (purpose === null) {
    const chosen = value.chosen ?? value.effective;
    return { model: chosen === null ? null : { provider: chosen.provider, model: chosen.model },
      thinking: chosen?.thinking ?? null, effective: value.effective };
  }
  const view = value.purposes.find((item) => item.purpose === purpose);
  return { model: view?.chosen.model ?? null, thinking: view?.chosen.thinking ?? null,
    effective: view?.effective ?? null };
}

const OPTION_SELECTOR = '[role="option"]';

/** 搜索框和各项之间上下键移动。 */
function moveFocus(root: HTMLElement | null, event: KeyboardEvent): void {
  if (root === null || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
    return;
  }
  const items = [...root.querySelectorAll<HTMLElement>(OPTION_SELECTOR)];
  if (items.length === 0) {
    return;
  }
  event.preventDefault();
  const index = items.findIndex((item) => item === document.activeElement);
  const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1) : index - 1;
  if (next < 0) {
    root.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  } else {
    items[next]?.focus();
  }
}

export function ModelChooserPanel({ value, purpose, onChoose, footer }: ChooserProps & { footer?: ReactNode }):
  ReactNode {
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const options = useMemo(() => chooserOptions(value, purpose), [value, purpose]);
  const current = currentOf(value, purpose);
  const needle = query.trim().toLowerCase();
  const shown = needle === '' ? options
    : options.filter((item) => `${item.group} ${item.name} ${item.model}`.toLowerCase().includes(needle));
  const groups = [...new Set(shown.map((item) => item.group))];
  const active = options.find((item) => item.key === keyOf(current.model ?? current.effective))
    ?? options.find((item) => item.key === keyOf(current.effective));
  const levels = active?.levels ?? [];
  const pickModel = (option: Option): void => {
    // 换了模型，原来单独选的思考档这个模型不支持就夹到它支持的；跟着的不动。
    const base = current.thinking ?? (purpose === null ? current.effective?.thinking ?? 'medium' : null);
    onChoose({ model: { provider: option.provider, model: option.model },
      thinking: base === null ? null : clampToLevels(option.levels, base) });
  };
  return (
    <div className="model-chooser" ref={root} onKeyDown={(event) => moveFocus(root.current, event)}>
      <label className="model-search">
        <Icon name="search" size={14} />
        <input type="search" className="search-input" aria-label="搜模型" placeholder="搜模型" value={query}
          aria-controls={listId} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="model-chooser-list" role="listbox" id={listId} aria-label="模型">
        {purpose === null || needle !== '' ? null : (
          <button type="button" role="option" aria-selected={current.model === null}
            className="model-chooser-option" onClick={() => onChoose({ model: null, thinking: null })}>
            <span className="model-chooser-name">{inheritLabel(purpose)}</span>
            {current.model === null ? <Icon name="check" size={14} /> : null}
          </button>
        )}
        {groups.map((group) => (
          <div key={group} role="group" aria-label={group}>
            <div className="model-chooser-group" aria-hidden="true">{group}</div>
            {shown.filter((item) => item.group === group).map((item) => {
              const selected = item.key === keyOf(current.model);
              return (
                <button key={item.key} type="button" role="option" aria-selected={selected}
                  className="model-chooser-option" onClick={() => pickModel(item)}>
                  <span className="model-chooser-name">{item.name}</span>
                  {selected ? <Icon name="check" size={14} /> : null}
                </button>
              );
            })}
          </div>
        ))}
        {shown.length === 0 ? <p className="model-chooser-empty">没有这个模型</p> : null}
      </div>
      {levels.length <= 1 ? null : (
        <div className="model-chooser-thinking">
          <span className="model-chooser-label" id={`${listId}-thinking`}>思考</span>
          <div className="segmented" role="group" aria-labelledby={`${listId}-thinking`}>
            {levels.map((level) => (
              <button key={level} type="button" className="segmented-item"
                aria-pressed={level === current.effective?.thinking}
                onClick={() => onChoose({ model: current.model, thinking: level })}>
                {THINKING_LABELS[level]}
              </button>
            ))}
          </div>
        </div>
      )}
      {footer}
    </div>
  );
}

export function ModelChooserPopover(props: ChooserProps & {
  anchor: PopoverAnchor;
  label: string;
  onClose: () => void;
  trigger?: RefObject<HTMLElement | null>;
  align?: 'start' | 'end';
  footer?: ReactNode;
}): ReactNode {
  const { anchor, label, onClose, trigger, align, ...panel } = props;
  return (
    <Popover anchor={anchor} role="dialog" label={label} align={align ?? 'end'} className="model-chooser-pop"
      onClose={onClose} {...(trigger === undefined ? {} : { trigger })}>
      <ModelChooserPanel {...panel} />
    </Popover>
  );
}
