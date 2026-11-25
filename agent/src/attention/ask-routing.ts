import type { Ask, AskPurpose } from '../../shared/state.ts';
import type { Answerer, AskResolver } from './asks.ts';
import type { Changes } from './changes.ts';

export function routeAsks(routes: Partial<Record<AskPurpose, AskResolver>>, fallback: AskResolver): AskResolver {
  return {
    deferred(changes, ask) {
      (routes[ask.purpose] ?? fallback).deferred?.(changes, ask);
    },
    validate(ask, at) {
      return (routes[ask.purpose] ?? fallback).validate?.(ask, at);
    },
    resolve(changes: Changes, ask: Ask, answerer: Answerer, at: string): void {
      const resolver = routes[ask.purpose] ?? fallback;
      resolver.resolve(changes, ask, answerer, at);
    },
  };
}
