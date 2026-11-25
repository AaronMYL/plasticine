import { Mates } from '../mates/index.ts';
import type { RequestContext } from './context.ts';

export function matesFor(context: RequestContext): Mates {
  return new Mates(context.deps.state, () => context.deps.lines);
}
