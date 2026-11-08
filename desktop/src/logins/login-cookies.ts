// 哪些网站算「登录着」（11-08《第 7 批》第 4 条）：以前这个域名有任何一条 Cookie 就算登录，抖音、X 没登录也报「已登录」
// ——没登录时它们照样种匿名 Cookie（抖音 ttwid / msToken / passport_csrf_token，X guest_id / gt / personalization_id）。
// 现在看登录凭证：认得的网站看它自己的凭证 Cookie；别的网站至少要有一条名字像登录凭证的（会话、令牌、登录），
// 跨站分析、CSRF、访客、同意弹框这些匿名 Cookie 不算。值是空的不算。

import { siteOf } from './chrome-cookies.ts';

/** 认得的网站：登录后才有的那几条 Cookie（按可注册域名）。 */
const SITE_CREDENTIALS: Readonly<Record<string, readonly string[]>> = {
  'douyin.com': ['sessionid', 'sessionid_ss', 'sid_guard'],
  'x.com': ['auth_token'],
  'twitter.com': ['auth_token'],
  'zhihu.com': ['z_c0'],
  'weibo.com': ['SUB'],
  'weibo.cn': ['SUB'],
  'bilibili.com': ['SESSDATA'],
  'xiaohongshu.com': ['web_session'],
};

/** 名字像登录凭证：会话、令牌、登录、用户身份。 */
const CREDENTIAL_NAME = /sess|auth|token|login|logged|sid|uid|user|jwt|remember/i;
/** 名字像也不算的匿名 Cookie：防跨站请求、访客、设备、同意弹框、分析统计。 */
const ANONYMOUS_NAME = /csrf|xsrf|guest|anon|visitor|device|consent|nonce|^_ga|^_gid|^_ue[sv]id|^_fbp|^__cf|^cf_/i;

export interface CookieLike {
  domain?: string;
  name: string;
  value: string;
}

function credential(site: string, cookie: CookieLike): boolean {
  if (cookie.value === '') {
    return false;
  }
  const known = SITE_CREDENTIALS[site];
  if (known !== undefined) {
    return known.includes(cookie.name);
  }
  return CREDENTIAL_NAME.test(cookie.name) && !ANONYMOUS_NAME.test(cookie.name);
}

/** 有登录凭证 Cookie 的网站（可注册域名），排好序。 */
export function loggedInSites(cookies: readonly CookieLike[]): string[] {
  const sites = new Set<string>();
  for (const cookie of cookies) {
    const site = siteOf(cookie.domain ?? '');
    if (site !== '' && credential(site, cookie)) {
      sites.add(site);
    }
  }
  return [...sites].sort();
}
