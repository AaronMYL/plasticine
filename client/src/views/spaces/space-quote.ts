import { currentComposer } from '../conversation/current-composer.ts';
import type { SpaceQuoteReference, SpaceView } from '../../api/shared.ts';
import { quoteLimitMessage } from '../../api/shared.ts';
import { useClientState } from '../../state/context.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { openConversation } from '../books/book-quote.ts';

export type SpaceQuoteAnchor = SpaceQuoteReference['anchor'];
export function useSpaceQuote(space: Pick<SpaceView, 'id' | 'version' | 'title' | 'genre'> | null)
  : (anchor: SpaceQuoteAnchor) => void {
  const targetState = useClientState();
  const { shellPrefs } = targetState;
  const phone = useViewportWidth() < PHONE_BELOW;
  return (anchor) => {
    if (space === null) return;
    const limit = quoteLimitMessage([{ text: anchor.text }]);
    if (limit !== null) throw new Error(limit);
    const kind = space.genre === 'letter' ? '来信' : '报告';
    currentComposer(targetState).ui.addQuote({
      id: `space:${space.id}:${space.version}:${anchor.paragraph}:${anchor.text}`,
      kind: 'space', sourceId: space.id, label: `${kind} · ${space.title} · 第 ${anchor.paragraph} 段`,
      text: anchor.text, spaceReference: { spaceId: space.id, version: space.version, anchor } });
    openConversation(shellPrefs, phone);
  };
}
