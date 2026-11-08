// 本实例网页的入口：只认同源根文档上的 hash 路由；附件、API、下载和配对邀请查询参数照常处理。
export function internalPageHash(address: string, server: string): string | null {
  try {
    const base = new URL(server);
    const url = new URL(address, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== base.origin || url.username !== ''
      || url.password !== '' || (url.pathname !== '/' && url.pathname !== '') || url.search !== '') return null;
    if (url.hash === '' || url.hash === '#') return '#/today';
    return /^#\/[^?#]*$/.test(url.hash) ? url.hash : null;
  } catch { return null; }
}
