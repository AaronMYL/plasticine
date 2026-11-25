import { expect, it } from 'vitest';
import { PRODUCT_ROUTES, productLink } from '../../../agent/shared/product-links.ts';
import { parseHash, routeHash } from '../../src/shell/routes.ts';

it('every model capability map deep link resolves to the same client object', () => {
  for (const entry of PRODUCT_ROUTES) {
    const hash = productLink(entry.kind, 'item 空格/斜线');
    const parsed = parseHash(hash);
    expect(parsed.view).toBe(entry.view);
    expect(parsed[entry.field]).toBe('item 空格/斜线');
    expect(routeHash(parsed)).toBe(hash);
  }
});
