import { internalPageHash } from '../../shared/internal-page.ts';
import { checkUrl } from '../daily/index.ts';

/** 普通网址只核对、不清洗（是他自己的浏览器，11-14 起自己用不清洗）；本实例的 # 路由是具体页面地址，不能在打开时变成首页。 */
export function browserUrl(raw: string, internalUrl?: string): string {
  const checked = checkUrl(raw);
  const hash = internalUrl === undefined ? null : internalPageHash(raw, internalUrl);
  return hash === null ? checked : checked.replace(/#.*$/, '') + hash;
}
