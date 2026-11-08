// 「装成客户端」验收的三种身份（2026-11-04 他定：无头浏览器装成客户端，模拟原生接口）。
// - mac：Mac App 的主窗口，1440×900，有鼠标（hover: hover），User-Agent 带 PlasticineMac/<版本>，注入 plasticineDesktop（桌面壳的桥）。
// - phone：手机浏览器，390×844，触屏（hover: none、pointer: coarse），手机 Safari 的 User-Agent，不注入桥。
//   2026-11-05 iPhone App（ios/）删掉了，手机上用网页，手机截图就用这一身份。
// - web：普通电脑浏览器，不带客户端标记、不注入桥（2026-11-05 起网页是正式端，没有门禁）。
// Mac 的版本号和原生会做的网页工具从原生源码读（mac/Resources/Info.plist、mac/…/web-page-tool-protocol.swift），
// 原生那边一改，模拟的客户端跟着改，不靠手抄。

import { readFileSync } from 'node:fs';
import { WEB_PAGE_TOOLS, type WebPageToolName } from '../../agent/shared/api/web-page-tools.ts';

export const CLIENT_NAMES = ['mac', 'phone', 'web'] as const;
export type ClientName = (typeof CLIENT_NAMES)[number];
export type NativeKind = 'mac' | 'ios';

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

const REPO = new URL('../../', import.meta.url);
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

function repoText(path: string): string {
  return readFileSync(new URL(path, REPO), 'utf8');
}

/** Info.plist 里 CFBundleShortVersionString 的值。 */
export function plistVersion(plist: string): string {
  const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
  if (match?.[1] === undefined) {
    throw new Error('Info.plist 里没有 CFBundleShortVersionString');
  }
  return match[1];
}

/** web-page-tool-protocol.swift 里 `static let supported = [...]` 报的工具名，只认 WEB_PAGE_TOOLS 里有的。 */
export function supportedTools(swift: string): WebPageToolName[] {
  const match = /static let supported = \[([^\]]*)\]/.exec(swift);
  if (match?.[1] === undefined) {
    throw new Error('原生源码里没有 WebPageTool.supported');
  }
  const names = [...match[1].matchAll(/"([a-z_]+)"/g)].map((entry) => entry[1] ?? '');
  const known: readonly string[] = WEB_PAGE_TOOLS;
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new Error(`原生报了网页侧不认识的网页工具：${unknown.join('、')}（agent/shared/api/web-page-tools.ts）`);
  }
  return names as WebPageToolName[];
}

export function clientProfile(name: ClientName): ClientProfile {
  if (name === 'mac') {
    const version = plistVersion(repoText('mac/Resources/Info.plist'));
    return { name, ...DESKTOP_SIZE, mobile: false, touch: false, platform: 'MacIntel',
      userAgent: `${MAC_UA_BASE} PlasticineMac/${version}`, native: 'mac', nativeVersion: version,
      tools: supportedTools(repoText('mac/Sources/Plasticine/web-page-tool-protocol.swift')) };
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
