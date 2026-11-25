import type { SpaceDoc } from '../../shared/state.ts';

export function summaryOf(title: string, doc: Pick<SpaceDoc, 'headline' | 'stats'>):
  { headline: string; stats: SpaceDoc['stats'] } {
  return { headline: doc.headline ?? title, stats: doc.stats };
}
