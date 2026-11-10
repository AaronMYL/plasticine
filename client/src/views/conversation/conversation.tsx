// 对话组件只有这一个（2026-11-05 Harness 重做）：读主对话那条线，消息里和 Plasticine 的全部记录（page）、右下的对话框
import './conversation.css';
// （column）、手机全屏（sheet）用的是同一份（views/lines/line-conversation.tsx）。对话框里才有「问这一页」。

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
