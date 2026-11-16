// 自定义提供商的「模型」一栏（11-16 Aaron：要思考档、上下文、是否支持图片）：一个模型一行——名字 ·「能思考」
// 「能看图」两个开关 · 上下文长度 · 移除；最后一行是输入框，回车添加（逗号、空格、换行隔开的一次加几个）。
// 「从接口读取」把接口列出来的摆在下面，点一下加进来，或「全部添加」；列表带了上下文长度的照着填。

import { useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  CONTEXT_WINDOW_CHOICES, DEFAULT_CONTEXT_WINDOW, MAX_CUSTOM_MODELS, type CustomModel,
  type TestModelConnectionResponse,
} from '../../api/shared.ts';
import { BusyText } from '../../primitives/busy/index.tsx';
import { Icon } from '../../shell/icons.tsx';

type Listed = NonNullable<TestModelConnectionResponse['models']>;

export interface ModelRowsProps {
  models: readonly CustomModel[];
  /** 接口列出来的；还没读过是 null。 */
  listed: Listed | null;
  listing: boolean;
  canList: boolean;
  onChange: (next: CustomModel[]) => void;
  onList: () => void;
}

function split(text: string): string[] {
  return text.split(/[\s,，、]+/).map((item) => item.trim()).filter((item) => item !== '');
}

/** 128000 → 128K，1000000 → 1M。 */
export function contextLabel(tokens: number): string {
  return tokens >= 1_000_000 ? `${String(+(tokens / 1_000_000).toFixed(1))}M` : `${String(Math.round(tokens / 1000))}K`;
}

export function newModel(id: string, contextWindow: number | null = null): CustomModel {
  return { id, reasoning: false, images: true, contextWindow: contextWindow ?? DEFAULT_CONTEXT_WINDOW };
}

function Flag({ on, label, model, onToggle }: { on: boolean; label: string; model: string;
  onToggle: () => void }): ReactNode {
  return (
    <button type="button" className="model-flag" aria-pressed={on} aria-label={`${model} ${label}`}
      onClick={onToggle}>
      {on ? <Icon name="check" size={12} /> : null}{label}
    </button>
  );
}

function ModelRow({ model, onChange, onRemove }: { model: CustomModel; onChange: (next: CustomModel) => void;
  onRemove: () => void }): ReactNode {
  const choices = CONTEXT_WINDOW_CHOICES.includes(model.contextWindow as (typeof CONTEXT_WINDOW_CHOICES)[number])
    ? CONTEXT_WINDOW_CHOICES : [...CONTEXT_WINDOW_CHOICES, model.contextWindow].sort((a, b) => a - b);
  return (
    <li className="model-row" aria-label={model.id}>
      <span className="model-row-name">{model.id}</span>
      <span className="model-row-controls">
        <Flag on={model.reasoning} label="能思考" model={model.id}
          onToggle={() => onChange({ ...model, reasoning: !model.reasoning })} />
        <Flag on={model.images} label="能看图" model={model.id}
          onToggle={() => onChange({ ...model, images: !model.images })} />
        <select className="model-row-context" aria-label={`${model.id} 上下文`} value={model.contextWindow}
          onChange={(event) => onChange({ ...model, contextWindow: Number(event.target.value) })}>
          {choices.map((tokens) => <option key={tokens} value={tokens}>{contextLabel(tokens)}</option>)}
        </select>
        <button type="button" className="model-row-remove" aria-label={`移除 ${model.id}`} onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      </span>
    </li>
  );
}

export function ModelRows({ models, listed, listing, canList, onChange, onList }: ModelRowsProps): ReactNode {
  const [draft, setDraft] = useState('');
  const add = (items: readonly CustomModel[]): void => {
    const next = [...models];
    for (const item of items) {
      if (!next.some((model) => model.id === item.id) && next.length < MAX_CUSTOM_MODELS) next.push(item);
    }
    onChange(next);
  };
  const contextOf = (id: string): number | null => listed?.find((item) => item.id === id)?.contextWindow ?? null;
  const commit = (): void => {
    add(split(draft).map((id) => newModel(id, contextOf(id))));
    setDraft('');
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    }
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const items = split(event.clipboardData.getData('text'));
    if (items.length < 2) return;
    event.preventDefault();
    add(items.map((id) => newModel(id, contextOf(id))));
  };
  const rest = (listed ?? []).filter((item) => !models.some((model) => model.id === item.id));
  return (
    <div className="connect-field">
      <span className="connect-label" id="custom-models-label">模型</span>
      <div className="model-rows">
        {models.length === 0 ? null : (
          <ul className="model-rows-list" aria-labelledby="custom-models-label">
            {models.map((model) => (
              <ModelRow key={model.id} model={model}
                onChange={(next) => onChange(models.map((item) => (item.id === model.id ? next : item)))}
                onRemove={() => onChange(models.filter((item) => item.id !== model.id))} />
            ))}
          </ul>
        )}
        <input className="model-rows-input" aria-label="添加模型" value={draft} spellCheck={false}
          placeholder="输入模型名，回车添加" onChange={(event) => setDraft(event.target.value)} onKeyDown={keys}
          onPaste={paste} onBlur={commit} />
      </div>
      <div className="model-chips-listed">
        <button type="button" className="text-button" disabled={!canList} onClick={onList}>
          <BusyText busy={listing} label="正在读">从接口读取</BusyText>
        </button>
        {listed !== null && rest.length === 0 && !listing
          ? <span className="model-chips-note">{listed.length === 0 ? '接口没有列出模型' : '都加上了'}</span> : null}
      </div>
      {rest.length === 0 ? null : (
        <div className="model-chips model-chips-suggest" role="group" aria-label="接口列出的模型">
          {rest.map((item) => (
            <button key={item.id} type="button" className="model-chip model-chip-add"
              onClick={() => add([newModel(item.id, item.contextWindow)])}>
              <Icon name="plus" size={12} />{item.id}
            </button>
          ))}
          <button type="button" className="text-button"
            onClick={() => add(rest.map((item) => newModel(item.id, item.contextWindow)))}>全部添加</button>
        </div>
      )}
    </div>
  );
}
