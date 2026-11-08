// One AskResolver for the desk that hands each card to whoever raised that kind: the line kernel for its approvals and
// questions, devices/ for device approvals, network/ for cross-user tasks … A purpose nobody claims goes to the fallback.

import type { Ask, AskPurpose } from '../../shared/state.ts';
import type { Answerer, AskResolver } from './asks.ts';
import type { Changes } from './changes.ts';

export function routeAsks(routes: Partial<Record<AskPurpose, AskResolver>>, fallback: AskResolver): AskResolver {
  return {
    validate(ask, at) {
      return (routes[ask.purpose] ?? fallback).validate?.(ask, at);
    },
    resolve(changes: Changes, ask: Ask, answerer: Answerer, at: string): void {
      const resolver = routes[ask.purpose] ?? fallback;
      resolver.resolve(changes, ask, answerer, at);
    },
  };
}
