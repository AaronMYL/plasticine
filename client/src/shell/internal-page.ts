import { internalPageHash, LEGACY_PUBLIC_URLS } from '../api/shared.ts';
import { parseHash, type Route } from './routes.ts';

export function internalPage(address: string): Route | null {
  const hash = internalPageHash(address, window.location.href);
  return hash === null ? null : parseHash(hash);
}

export function inAppHash(href: string, base: string = window.location.href): string | null {
  if (!/^https?:\/\/[^#]*#\//i.test(href)) {
    return null;
  }
  for (const server of [base, ...LEGACY_PUBLIC_URLS]) {
    const hash = internalPageHash(href, server);
    if (hash !== null) {
      return hash;
    }
  }
  return null;
}
