export const DEFAULT_PUBLIC_URL = 'http://127.0.0.1:8790';

/** 客户端采用 hash 路由；任务目前只有清单入口，没有单项路径。 */
export function publicPage(publicUrl: string, route: string): string {
  return `${publicUrl.replace(/\/$/, '')}/#/${route}`;
}
