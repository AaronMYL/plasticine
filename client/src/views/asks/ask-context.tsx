import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AskAnswerPlace } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import type { AnswerInput } from './asks-store.ts';

interface AskPlace {
  place: AskAnswerPlace | null;
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

export function useAnswerAsk(): AnswerAsk {
  const live = useLive();
  const { place } = useContext(AskPlaceContext);
  return (ask, input) => live.asks.answer(ask, place === null ? input : { ...input, place });
}

export function AskSource({ ask }: { ask: AskView }): ReactNode {
  const label = useContext(AskPlaceContext).source(ask);
  return label === null ? null : <p className="line-ask-thread">{label}</p>;
}
