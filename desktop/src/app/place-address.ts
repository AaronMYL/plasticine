import { normalizeRemoteUrl, RemoteUrlError } from './server-target.ts';

export const NETWORK_DOMAIN = 'cyberhunter.top';
const HANDLE = /^[a-z0-9_]{3,24}$/;
const HOST_LABEL = /^[a-z0-9-]{3,24}$/;

export function handleHost(handle: string): string {
  return handle.replace(/_/g, '-');
}

export class PlaceAddressError extends Error {}

export interface PlaceAddress {
  url: string;
  handle: string | null;
}

export function parsePlaceAddress(input: string): PlaceAddress {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new PlaceAddressError('填你的 @账号，或 Plasticine 的地址。');
  }
  if (/[.:/]/.test(trimmed)) {
    try {
      return { url: normalizeRemoteUrl(trimmed), handle: null };
    } catch (error) {
      if (error instanceof RemoteUrlError) {
        throw new PlaceAddressError('地址要是 https:// 开头的网址，比如 https://你的账号.cyberhunter.top。',
          { cause: error });
      }
      throw error;
    }
  }
  const handle = trimmed.replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) {
    throw new PlaceAddressError('@账号是 3–24 位小写字母、数字或下划线。');
  }
  return { url: `https://${handleHost(handle)}.${NETWORK_DOMAIN}/`, handle };
}

export function displayPlace(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    if (error instanceof TypeError) {
      return '';
    }
    throw error;
  }
  const suffix = `.${NETWORK_DOMAIN}`;
  const label = parsed.hostname.endsWith(suffix) ? parsed.hostname.slice(0, -suffix.length) : '';
  if (parsed.port === '' && HOST_LABEL.test(label)) {
    return `@${label.replace(/-/g, '_')}`;
  }
  return parsed.host;
}
