import { describe, expect, it } from 'vitest';
import { parseHash, routeHash } from '../../src/shell/routes.ts';

describe('feed item routes', () => {
  it('feed item routes can be copied and refreshed with encoded ID roundtrip', () => {
    const route = { view: 'feed' as const, noteId: null, feedItemId: 'item/a b' };
    expect(routeHash(route)).toBe('#/feed/item%2Fa%20b');
    expect(parseHash('#/feed/item%2Fa%20b')).toEqual(route);
  });
});
