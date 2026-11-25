import { internalPageHash } from '../../shared/internal-page.ts';
import { checkUrl } from '../daily/index.ts';

export function browserUrl(raw: string, internalUrl?: string): string {
  const checked = checkUrl(raw);
  const hash = internalUrl === undefined ? null : internalPageHash(raw, internalUrl);
  return hash === null ? checked : checked.replace(/#.*$/, '') + hash;
}
