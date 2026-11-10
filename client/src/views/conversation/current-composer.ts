import type { ClientState } from '../../state/context.tsx';
import type { LineComposerState } from '../../state/conversation-registry.ts';

export function currentComposer(state: ClientState): LineComposerState {
  state.dockTargets.protectCurrent();
  return state.conversations.forLine(state.dockTargets.store.get().lineId);
}

