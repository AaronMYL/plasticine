import { currentComposer } from '../views/conversation/current-composer.ts';
import { useMemo } from 'react';
import { useApi } from '../api/context.tsx';
import type { Quote } from '../api/types.ts';
import { useClientState } from '../state/context.tsx';

export interface WebChrome {
  quote: (quote: Quote) => void;
  attach: (files: File[]) => Promise<void>;
  openNote: (noteId: string) => void;
}

export function useWebChrome(expandChat: () => void, openNote: (noteId: string) => void): WebChrome {
  const api = useApi();
  const targetState = useClientState();
  return useMemo(() => ({
    quote: (quote) => {
      currentComposer(targetState).ui.addQuote(quote);
      expandChat();
    },
    attach: async (files) => {
      expandChat();
      await currentComposer(targetState).attachments.add(files, api.attachments);
    },
    openNote,
  }), [api, targetState, expandChat, openNote]);
}
