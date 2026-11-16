// 自定义提供商的「模型」一栏：填过的一个一块（× 移除），下面一个输入框回车添加（逗号、空格、换行隔开的一次加几个），
// 「从接口读取」把接口列出来的模型摆在下面，点一下加进来，或「全部添加」。

import { useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { MAX_CUSTOM_MODELS } from '../../api/shared.ts';
import { BusyText } from '../../primitives/busy/index.tsx';
import { Icon } from '../../shell/icons.tsx';

export interface ModelChipsProps {
  models: readonly string[];
  /** 接口列出来的；还没读过是 null。 */
  listed: readonly string[] | null;
  listing: boolean;
  canList: boolean;
  onChange: (next: string[]) => void;
  onList: () => void;
}

function split(text: string): string[] {
  return text.split(/[\s,，、]+/).map((item) => item.trim()).filter((item) => item !== '');
}

export function ModelChips({ models, listed, listing, canList, onChange, onList }: ModelChipsProps): ReactNode {
  const [draft, setDraft] = useState('');
  const add = (items: readonly string[]): void => {
    const next = [...models];
    for (const item of items) {
      if (!next.includes(item) && next.length < MAX_CUSTOM_MODELS) next.push(item);
    }
    onChange(next);
  };
  const commit = (): void => {
    add(split(draft));
    setDraft('');
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && models.length > 0) {
      onChange(models.slice(0, -1));
    }
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const items = split(event.clipboardData.getData('text'));
    if (items.length < 2) return;
    event.preventDefault();
    add(items);
  };
  const rest = (listed ?? []).filter((item) => !models.includes(item));
  return (
    <div className="connect-field">
      <span className="connect-label" id="custom-models-label">模型</span>
      <div className="model-chips" role="group" aria-labelledby="custom-models-label">
        {models.map((model) => (
          <span key={model} className="model-chip">
            <span className="model-chip-text">{model}</span>
            <button type="button" aria-label={`移除 ${model}`}
              onClick={() => onChange(models.filter((item) => item !== model))}>
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
        <input className="model-chip-input" aria-label="添加模型" value={draft} spellCheck={false}
          placeholder={models.length === 0 ? '输入模型名，回车添加' : '再加一个'}
          onChange={(event) => setDraft(event.target.value)} onKeyDown={keys} onPaste={paste} onBlur={commit} />
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
          {rest.map((model) => (
            <button key={model} type="button" className="model-chip model-chip-add" onClick={() => add([model])}>
              <Icon name="plus" size={12} />{model}
            </button>
          ))}
          <button type="button" className="text-button" onClick={() => add(rest)}>全部添加</button>
        </div>
      )}
    </div>
  );
}
