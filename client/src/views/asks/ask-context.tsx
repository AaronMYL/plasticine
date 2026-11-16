// 一张卡在哪画（11-16 卡片回到对话里）：在出它的对话、交办它的上级对话、「等你」、和朋友的聊天里都画，在哪答都行。
// 卡所在的地方给卡两样东西：在哪答的（记在答案上，各处收成一行时写出来），和这张卡是谁、哪件事问的（标题下面一行）。

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AskAnswerPlace } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import type { AnswerInput } from './asks-store.ts';

interface AskPlace {
  place: AskAnswerPlace | null;
  /** 这张卡是谁、哪件事问的；出它的就是这段对话时是 null（不重复写）。 */
  source: (ask: AskView) => string | null;
}

const NO_SOURCE = (): null => null;
const AskPlaceContext = createContext<AskPlace>({ place: null, source: NO_SOURCE });

export function AskPlaceProvider({ place, source, children }: { place: AskAnswerPlace;
  source?: (ask: AskView) => string | null; children: ReactNode }): ReactNode {
  const value = useMemo(() => ({ place, source: source ?? NO_SOURCE }), [place, source]);
  return <AskPlaceContext.Provider value={value}>{children}</AskPlaceContext.Provider>;
}

export type AnswerAsk = (ask: AskView, input: Omit<AnswerInput, 'place'>) => Promise<void>;

/** 作答：带上卡所在的地方。 */
export function useAnswerAsk(): AnswerAsk {
  const live = useLive();
  const { place } = useContext(AskPlaceContext);
  return (ask, input) => live.asks.answer(ask, place === null ? input : { ...input, place });
}

/** 卡标题下面一行：谁、哪件事问的（「求职顾问 · 海投打招呼」）。 */
export function AskSource({ ask }: { ask: AskView }): ReactNode {
  const label = useContext(AskPlaceContext).source(ask);
  return label === null ? null : <p className="line-ask-thread">{label}</p>;
}
