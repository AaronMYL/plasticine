// 外部链接的校验（11-14 Aaron 定「自己用不清洗，分享出去才清洗」）：存进库、回给他自己设备的是原链接，这里只核对
// 是不是完整的 http / https 地址、长度够不够；清洗规则在 ../link-clean.ts，只用在往外送的地方。
// linkKey 是按清洗规则洗过的样子，只拿来比对去重（10-28 起存的是洗过的链接，新旧要对得上），不存、不显示。
// 不把 URL 解析错误的原文或 cause 带到日志。

import { FEED_URL_MAX_CHARS } from '../../shared/state.ts';
import { cleanUrlQuery, isCredentialParam } from '../link-clean.ts';
import { shownError } from './errors.ts';

export { cleanUrlQuery, isCredentialParam };

function parsed(raw: string, field: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // The text itself is not echoed: a malformed link may still carry a token, and errors reach logs.
    // Not even as the cause: node's URL error keeps the input text.
    throw shownError('invalid_input', '链接不是完整的网址；请用 https:// 或 http:// 开头的地址。', field);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw shownError('invalid_input', '链接只收 http / https 地址。', field);
  }
  return url;
}

function bounded(link: string, field: string): string {
  if (link.length > FEED_URL_MAX_CHARS) {
    throw shownError('invalid_input', `链接超过 ${FEED_URL_MAX_CHARS} 个字符。`, field);
  }
  return link;
}

/** 核对过的原链接（参数、# 后面都留着），或一个写给 `field` 的 DailyError（shownError）。 */
export function checkUrl(raw: string, field = 'url'): string {
  return bounded(parsed(raw, field).href, field);
}

/** 按清洗规则洗过的样子（去掉用户名密码、像凭据的参数和 # 后面）：只拿来比对、去重。 */
export function linkKey(raw: string, field = 'url'): string {
  const url = parsed(raw, field);
  url.username = '';
  url.password = '';
  // 只筛掉有问题的那一对，不重新序列化安全参数，保留名称大小写、编码、顺序和同名的安全值。
  const query = url.search.slice(1);
  const cleanedQuery = cleanUrlQuery(query);
  if (cleanedQuery !== query) {
    url.search = cleanedQuery;
  }
  url.hash = '';
  return bounded(url.toString(), field);
}

/** The host of a link (信息源的「最近来源」). */
export function siteOf(url: string): string {
  return new URL(checkUrl(url)).host;
}
