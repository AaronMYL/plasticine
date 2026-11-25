import './conversation.css';

import type { ReactNode } from 'react';
import { MAIN_LINE_ALIAS } from '../../api/shared.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { SideUiProvider } from '../lines/conversation-ui-context.tsx';
import { LineConversation } from '../lines/line-conversation.tsx';
import type { ConversationContainer } from './container.ts';

export function Conversation({ container }: { container: ConversationContainer }): ReactNode {
  const state = useClientState();
  const target = useStore(state.dockTargets.store);
  const lineId = container === 'page' ? MAIN_LINE_ALIAS : target.lineId;
  return (
    <div className={`conv conv-${container}`} data-container={container}>
      <SideUiProvider lineId={lineId}><LineConversation key={lineId} lineId={lineId}
        askPage={container !== 'page'} /></SideUiProvider>
    </div>
  );
}
