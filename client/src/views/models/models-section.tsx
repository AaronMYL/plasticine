// 设置 · AI（《优化清单》第 13 条；第13批照设计稿 PredictSettings 改成一栏分组）：最上「模型」每家启用哪几个，下面一行
// 默认模型；再往下按用在哪儿分组（ai-groups.tsx）。都是选了马上存，没有草稿和保存按钮。

import { useEffect, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { AiGroups } from './ai-groups.tsx';
import { AiProviders } from './ai-providers.tsx';
import { PurposeRow } from './ai-purposes.tsx';
import './models.css';
import './ai-models.css';

export function ModelsSection(): ReactNode {
  const live = useLive();
  const value = useStore(live.models.store).value;
  useEffect(() => {
    void live.models.reload();
  }, [live.models]);
  return (
    <div className="block ai-models" aria-label="模型设置" role="group">
      <AiProviders>
        {value === null ? null : <PurposeRow value={value} purpose={null} label="默认模型" sub="没单独选的功能都用它" />}
      </AiProviders>
      <AiGroups />
    </div>
  );
}
