// 设置 · AI 的模型块（《优化清单》第 13 条，设计稿 Settings-AI）：左边「模型」每家启用哪几个，右边「各用哪个」。
// 都是选了马上存，没有草稿和保存按钮；手机上上下两段。

import { useEffect, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { AiProviders } from './ai-providers.tsx';
import { AiPurposes } from './ai-purposes.tsx';
import './models.css';
import './ai-models.css';

export function ModelsSection(): ReactNode {
  const live = useLive();
  useEffect(() => {
    void live.models.reload();
  }, [live.models]);
  return (
    <div className="block ai-models" aria-label="模型设置" role="group">
      <AiProviders />
      <AiPurposes />
    </div>
  );
}
