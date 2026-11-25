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
