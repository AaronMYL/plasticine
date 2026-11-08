// 网页工具条要壳给的那一份（圈一块、截图交给对话框，存进笔记后「打开」）。两层侧栏之前在 tab-chrome.tsx 里，和顶部标签栏
// 一起；顶部标签栏没了，只留这三样。

import { useMemo } from 'react';
import { useApi } from '../api/context.tsx';
import type { Quote } from '../api/types.ts';
import { useClientState } from '../state/context.tsx';

export interface WebChrome {
  /** 圈一块：引用片放进对话框输入框，对话框展开。 */
  quote: (quote: Quote) => void;
  /** 截图给 Plasticine：附件放进对话框输入框，对话框展开。 */
  attach: (files: File[]) => Promise<void>;
  /** 存进笔记之后点「打开」。 */
  openNote: (noteId: string) => void;
}

export function useWebChrome(expandChat: () => void, openNote: (noteId: string) => void): WebChrome {
  const api = useApi();
  const { conversationUi, attachments } = useClientState();
  return useMemo(() => ({
    quote: (quote) => {
      conversationUi.addQuote(quote);
      expandChat();
    },
    attach: async (files) => {
      expandChat();
      await attachments.add(files, api.attachments);
    },
    openNote,
  }), [api, conversationUi, attachments, expandChat, openNote]);
}
