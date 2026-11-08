// 对话的界面状态（草稿、引用、回复、滚动）按线分开（《优化清单》第 17 条）：主线用全局那一份（对话框、消息页、
// 手机全屏共用）；每条旁聊各一份，切来切去草稿都在。组件用 useConversationUi() 拿当前这条线的。

import { createContext, useContext, type ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { ConversationUi } from '../../state/conversation-ui.ts';

const SideUiContext = createContext<ConversationUi | null>(null);
const sides = new Map<string, ConversationUi>();

/** 一条旁聊自己的那一份（不存刷新草稿：刷新草稿只给主线）。 */
export function sideUi(lineId: string): ConversationUi {
  let ui = sides.get(lineId);
  if (ui === undefined) {
    ui = new ConversationUi(null);
    sides.set(lineId, ui);
  }
  return ui;
}

export function SideUiProvider({ lineId, children }: { lineId: string; children: ReactNode }): ReactNode {
  return <SideUiContext.Provider value={sideUi(lineId)}>{children}</SideUiContext.Provider>;
}

export function useConversationUi(): ConversationUi {
  const side = useContext(SideUiContext);
  const { conversationUi } = useClientState();
  return side ?? conversationUi;
}
