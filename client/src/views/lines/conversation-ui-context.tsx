// 同一条线在整页和对话框里共用文字、引用和附件；切目标只切注册表中的那一份。
import { createContext, useContext, type ReactNode } from 'react';
import { MAIN_LINE_ALIAS } from '../../api/shared.ts';
import { useClientState } from '../../state/context.tsx';
import type { LineComposerState } from '../../state/conversation-registry.ts';
import type { ConversationUi } from '../../state/conversation-ui.ts';
import type { AttachmentDrafts } from '../../state/attachment-drafts.ts';

const ComposerContext = createContext<LineComposerState | null>(null);

export function SideUiProvider({ lineId, children }: { lineId: string; children: ReactNode }): ReactNode {
  const { conversations } = useClientState();
  return <ComposerContext.Provider value={conversations.forLine(lineId)}>{children}</ComposerContext.Provider>;
}

function useComposerState(): LineComposerState {
  const current = useContext(ComposerContext);
  const { conversations } = useClientState();
  return current ?? conversations.forLine(MAIN_LINE_ALIAS);
}

export function useConversationUi(): ConversationUi { return useComposerState().ui; }
export function useComposerAttachments(): AttachmentDrafts { return useComposerState().attachments; }
