import { WEB_PAGE_TOOLS, type WebPageToolName } from '../../agent/shared/api/web-page-tools.ts';

export const CLIENT_NAMES = ['mac', 'phone', 'web'] as const;
export type ClientName = (typeof CLIENT_NAMES)[number];
export type NativeKind = 'mac';

export interface ClientProfile {
  name: ClientName;
  width: number;
  height: number;
  mobile: boolean;
  touch: boolean;
  userAgent: string;
  platform: string;
  native: NativeKind | null;
  nativeVersion: string;
  tools: WebPageToolName[];
}

const MAC_UA_BASE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/140.0.0.0 Safari/537.36';
export const DESKTOP_SIZE = { width: 1440, height: 900 } as const;
export const PHONE_SIZE = { width: 390, height: 844 } as const;

const DESKTOP_VERSION = '1.0.0';

export function clientProfile(name: ClientName): ClientProfile {
  if (name === 'mac') {
    return { name, ...DESKTOP_SIZE, mobile: false, touch: false, platform: 'MacIntel',
      userAgent: `${MAC_UA_BASE} PlasticineDesktop/${DESKTOP_VERSION}`, native: 'mac',
      nativeVersion: DESKTOP_VERSION, tools: [...WEB_PAGE_TOOLS] };
  }
  if (name === 'phone') {
    return { name, ...PHONE_SIZE, mobile: true, touch: true, platform: 'iPhone', userAgent: PHONE_UA, native: null,
      nativeVersion: '', tools: [] };
  }
  return { name, ...DESKTOP_SIZE, mobile: false, touch: false, platform: 'MacIntel', userAgent: CHROME_UA,
    native: null, nativeVersion: '', tools: [] };
}

export function isClientName(value: string): value is ClientName {
  const names: readonly string[] = CLIENT_NAMES;
  return names.includes(value);
}
