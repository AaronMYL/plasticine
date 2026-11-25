import type { SpaceListItem, SubscriptionListItem } from '../../api/shared.ts';
import type { HueName } from '../hue.tsx';
import type { IconName } from '../icons.tsx';

export interface Look {
  icon: IconName;
  hue: HueName;
}

export function spaceLook(space: Pick<SpaceListItem, 'kind' | 'author'>
  & { genre?: SpaceListItem['genre']; category?: SpaceListItem['category'] }): Look {
  if (space.category === 'webarchive') return { icon: 'globe', hue: 'teal' };
  if (space.category === 'booknote') return { icon: 'books', hue: 'ochre' };
  if (space.genre === 'letter') return { icon: 'mail', hue: 'ochre' };
  if (space.kind === 'research') return { icon: 'chart', hue: 'sky' };
  if (space.kind === 'review') return { icon: 'sparkle', hue: 'teal' };
  return { icon: 'file', hue: space.author === 'ai' ? 'sky' : 'sage' };
}

export function subscriptionLook(kind: SubscriptionListItem['kind']): Look {
  return kind === 'review' ? { icon: 'sparkle', hue: 'teal' } : { icon: 'chart', hue: 'sky' };
}
