import { expect, it } from 'vitest';
import { PRODUCT_ROUTES, productLink } from '../../../agent/shared/product-links.ts';
import { parseHash, routeHash } from '../../src/shell/routes.ts';

it('模型能力地图的每种深链都能回到客户端同一个对象', () => {
  for (const entry of PRODUCT_ROUTES) {
    const hash = productLink(entry.kind, 'item 空格/斜线');
    const parsed = parseHash(hash);
    expect(parsed.view).toBe(entry.view);
    expect(parsed[entry.field]).toBe('item 空格/斜线');
    expect(routeHash(parsed)).toBe(hash);
  }
});
