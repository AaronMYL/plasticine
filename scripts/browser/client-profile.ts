// 「装成客户端」验收的三种身份（2026-11-04 他定：无头浏览器装成客户端，模拟原生接口）。
// - mac：Mac 上的桌面客户端（Electron 壳）主窗口，1440×900，有鼠标（hover: hover），User-Agent 带
//   PlasticineDesktop/<版本>，注入 plasticineDesktop（桌面壳的桥）。
// - phone：手机浏览器，390×844，触屏（hover: none、pointer: coarse），手机 Safari 的 User-Agent，不注入桥。
//   2026-11-05 iPhone App（ios/）删掉了，手机上用网页，手机截图就用这一身份。
// - web：普通电脑浏览器，不带客户端标记、不注入桥（2026-11-05 起网页是正式端，没有门禁）。
// 桌面壳会做的网页工具和壳一样取 WEB_PAGE_TOOLS（desktop/src/tabs/tab-tools.ts 的 SHELL_TOOLS），不靠手抄；
// 旧 Swift Mac App 11-17 删了，不再从它的源码读。

import { WEB_PAGE_TOOLS, type WebPageToolName } from '../../agent/shared/api/web-page-tools.ts';

export const CLIENT_NAMES = ['mac', 'phone', 'web'] as const;
export type ClientName = (typeof CLIENT_NAMES)[number];
export type NativeKind = 'mac';

export interface ClientProfile {
  name: ClientName;
  width: number;
  height: number;
  /** 手机布局（CDP 的 mobile）：视口按手机算，滚动条不占宽。 */
  mobile: boolean;
  /** 触屏：开了就是 hover: none、pointer: coarse；没开就是浏览器启动时设的有鼠标。 */
  touch: boolean;
  userAgent: string;
  platform: string;
  /** 注入哪一个原生桥；null 是普通浏览器。 */
  native: NativeKind | null;
  nativeVersion: string;
  /** 原生报的网页工具（webTabs.tools）。 */
  tools: WebPageToolName[];
}

// 两台机器的系统版本只进 User-Agent 的外壳，网页不读它；取写这份时的正式版本。
const MAC_UA_BASE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/140.0.0.0 Safari/537.36';
/** 电脑验收的窗口：《plasticine-visual》四个尺寸里的电脑那一档。 */
export const DESKTOP_SIZE = { width: 1440, height: 900 } as const;
/** 手机验收的窗口：iPhone 15 / 16 的 CSS 视口。 */
export const PHONE_SIZE = { width: 390, height: 844 } as const;

/** 模拟的桌面客户端版本号：界面只看有没有，不比大小。 */
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
