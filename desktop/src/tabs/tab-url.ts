// 报给界面的标签网址（11-08）：Electron 在 did-start-loading 时 getURL() 还是空的，要到 did-navigate 才有；那之前用最近
// 一次叫它载入的网址。两样都空就不报——界面会把空网址当成站内首页，关掉标签、跳回首页。

/** 该报的网址；没有可报的是 null（这一次不报）。 */
export function reportedUrl(current: string, requested: string): string | null {
  if (current.trim() !== '') {
    return current;
  }
  return requested.trim() === '' ? null : requested;
}
