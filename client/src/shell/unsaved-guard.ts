import { useEffect } from 'react';
import type { ClientState } from '../state/context.tsx';

export type UnsavedState = Pick<ClientState, 'noteDrafts' | 'conversationUi' | 'outbox' | 'noteOps'> &
  Partial<Pick<ClientState, 'actionOps' | 'inlineDrafts' | 'editDrafts' | 'signedOps'
    | 'attachments' | 'conversations'>>;

export function hasUnsavedWork(state: UnsavedState): boolean {
  const composer = state.conversationUi.store.get();
  const composerHasWork =
    (composer.draft.trim() !== '' || composer.quotes.length > 0) && !state.conversationUi.savedForRefresh();
  const actionsPending = (state.actionOps?.hasPending() ?? false) || (state.inlineDrafts?.hasAny() ?? false);
  const notesPending = state.noteDrafts.hasAny() || state.noteOps.hasPending();
  const cognitionPending = (state.editDrafts?.hasAny() ?? false) || (state.signedOps?.hasPending() ?? false);
  return (
    notesPending ||
    (state.conversations?.hasDrafts() ?? composerHasWork) ||
    state.outbox.hasAny() ||
    actionsPending ||
    cognitionPending ||
    (state.conversations?.hasAttachments() ?? state.attachments?.hasAny() ?? false)
  );
}

export function useUnsavedGuard(state: UnsavedState): void {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (hasUnsavedWork(state)) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state]);
}
