// Plasticine 写给他的链接从哪个地址出发由服务端按需定（agent/src/app/public-url.ts：环境变量 > @账号网址 > 本机）。
/**
 * 以前没配地址时链接写的是服务器的 IP（11-08 之前的老消息里还有）：客户端把指向它的 #/ 链接当成站内地址打开。
 * 只用来认老链接，不再拿来拼新链接。
 */
export const LEGACY_PUBLIC_URLS: readonly string[] = ['https://203.0.113.10'];

/** 客户端采用 hash 路由；任务目前只有清单入口，没有单项路径。 */
export function publicPage(publicUrl: string, route: string): string {
  return `${publicUrl.replace(/\/$/, '')}/#/${route}`;
}
