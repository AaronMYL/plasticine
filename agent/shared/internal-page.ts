// 本实例网页的入口：只认同源根文档上的 hash 路由；附件、API、下载和配对邀请查询参数照常处理。
export function internalPageHash(address: string, server: string): string | null {
  // 空网址不是站内首页（11-08）：桌面壳新开标签时报过一次空网址，被当成首页，标签关掉、跳回了首页。
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
