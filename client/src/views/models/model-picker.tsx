// 输入框里的模型按钮（《优化清单》第 13 条）：点开是共用的选模型弹层；在这里切换就是改这个用途（默认主线）的默认，
// 设置 · AI 里那一行跟着变，别的用途不变。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModelPurpose } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { useStore } from '../../state/use-store.ts';
import { ModelChooserPopover } from './model-chooser.tsx';
import { choiceLabel } from './model-store.ts';

export function ModelPicker({ purpose = 'main', name = '对话模型' }: { purpose?: ModelPurpose; name?: string })
  : ReactNode {
  const live = useLive();
  const data = useStore(live.models.store);
  const openPanel = useOpenPanel();
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!data.loaded) {
      void live.models.reload();
    }
  }, [data.loaded, live.models]);
  const value = data.value;
  const label = choiceLabel(value, purpose);
  if (value === null || label === null) {
    return (
      <button type="button" className="line-model" onClick={() => openPanel({ kind: 'settings', section: 'ai' })}>
        连接模型
      </button>
    );
  }
  return (
    <>
      <button ref={button} type="button" className="line-model" aria-haspopup="dialog" aria-expanded={menu !== null}
        aria-label={`${name}：${label}`}
        onClick={(event) => setMenu(menu === null ? anchorOf(event.currentTarget) : null)}>
        <span>{label}</span><Icon name="chevron-down" size={12} />
      </button>
      {error === null ? null : <span className="line-model-error" role="alert">{error}</span>}
      {menu === null ? null : (
        <ModelChooserPopover anchor={menu} label={name} align="start" trigger={button} value={value}
          purpose={purpose} onClose={() => setMenu(null)}
          onChoose={(change) => void live.models.choosePurpose(purpose, change).then(setError)}
          footer={(
            <button type="button" className="model-chooser-manage" onClick={() => {
              setMenu(null);
              openPanel({ kind: 'settings', section: 'ai' });
            }}>
              <Icon name="sliders" size={14} />管理模型
            </button>
          )} />
      )}
    </>
  );
}
