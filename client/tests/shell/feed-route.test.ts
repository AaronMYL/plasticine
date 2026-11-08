import { describe, expect, it } from 'vitest';
import { parseHash, routeHash } from '../../src/shell/routes.ts';

describe('信息流对象路由', () => {
  it('信息流对象路由可复制和刷新，ID按编码往返', () => {
    const route = { view: 'feed' as const, noteId: null, feedItemId: 'item/a b' };
    expect(routeHash(route)).toBe('#/feed/item%2Fa%20b');
    expect(parseHash('#/feed/item%2Fa%20b')).toEqual(route);
  });
});
