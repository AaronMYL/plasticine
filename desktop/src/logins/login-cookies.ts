import { siteOf } from './chrome-cookies.ts';

const SITE_CREDENTIALS: Readonly<Record<string, readonly string[]>> = {
  'douyin.com': ['sessionid', 'sessionid_ss', 'sid_guard'],
  'x.com': ['auth_token'],
  'twitter.com': ['auth_token'],
  'zhihu.com': ['z_c0'],
  'weibo.com': ['SUB'],
  'weibo.cn': ['SUB'],
  'bilibili.com': ['SESSDATA'],
  'xiaohongshu.com': ['web_session'],
  'reddit.com': ['reddit_session'],
};

const CREDENTIAL_NAME = /sess|auth|token|login|logged|sid|uid|user|jwt|remember/i;
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
