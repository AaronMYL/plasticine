import { internalPageHash } from '../../shared/internal-page.ts';
import { cleanUrl } from '../daily/index.ts';

/** 普通网址沿用现有清洗；本实例的 # 路由是具体页面地址，不能在打开时变成首页。 */
export function browserUrl(raw: string, internalUrl?: string): string {
  const cleaned = cleanUrl(raw);
  const hash = internalUrl === undefined ? null : internalPageHash(raw, internalUrl);
  return hash === null ? cleaned : cleaned + hash;
}
