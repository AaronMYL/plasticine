export function internalPageHash(address: string, server: string): string | null {
  if (address.trim() === '') return null;
  try {
    const base = new URL(server);
    const url = new URL(address, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== base.origin || url.username !== ''
      || url.password !== '' || (url.pathname !== '/' && url.pathname !== '') || url.search !== '') return null;
    if (url.hash === '' || url.hash === '#') return '#/today';
    return /^#\/[^?#]*$/.test(url.hash) ? url.hash : null;
  } catch { return null; }
}
