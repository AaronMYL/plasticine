import type { ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';

export function ComposePredictSwitch(): ReactNode {
  const { shellPrefs } = useClientState();
  const on = useStore(shellPrefs.store).composePredict;
  return <input type="checkbox" role="switch" aria-label="输入建议" checked={on}
    onChange={(event) => shellPrefs.setComposePredict(event.currentTarget.checked)} />;
}
