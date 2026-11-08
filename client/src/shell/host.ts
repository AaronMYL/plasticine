// 界面调用壳的唯一入口（第 14 条：界面调用壳的接口统一成一个，两端实现同一份）。背后是桌面壳注入的
// window.plasticineDesktop（11-08 起 Electron 壳，Mac、Windows 共用；agent/shared/api/desktop-bridge.ts），和旧 iPhone 壳的
// window.plasticineIOS（同一份网页标签协议）。还装着的 Swift Mac App 挂的是旧名字 window.plasticineMac，只在 bridge() 里认，
// 等它被 Electron 版换掉就删这一处。界面里别的地方不直接碰 window.plasticine*。没有壳（网页版、手机浏览器）时一律回
// null，界面照网页的做法走。

import type {
  PlasticineDesktopExternal,
  PlasticineDesktopServer,
  PlasticineIOSBridge,
  PlasticineMacLogins,
  PlasticineMacWebTabs,
  PlasticineMacWindowChrome,
} from '../api/shared.ts';
import type { PlasticineMacTranslate } from '../api/shared.ts';
import type { HostBridge } from '../mac/bridge.ts';
import type { DesktopHelperBridge } from '../mac/desktop-helper.ts';
import '../mac/bridge.ts';
import '../ios/bridge.ts';

/** 跑在哪：桌面客户端（现在是 Mac App）、旧的 iPhone 壳、普通浏览器。 */
export type HostKind = 'desktop' | 'ios' | 'web';

const DESKTOP_AGENT = /(?:^|\s)PlasticineMac\/[^\s]+(?:\s|$)/;
const IOS_AGENT = /(?:^|\s)PlasticineIOS\/[^\s]+(?:\s|$)/;

/** 桌面壳的桥：Electron 壳的新名字，或旧 Swift Mac App 的旧名字。 */
function bridge(): HostBridge | undefined {
  return window.plasticineDesktop ?? window.plasticineMac;
}

export function hostKind(): HostKind {
  if (bridge() !== undefined || DESKTOP_AGENT.test(navigator.userAgent)) return 'desktop';
  if (window.plasticineIOS !== undefined || IOS_AGENT.test(navigator.userAgent)) return 'ios';
  return 'web';
}

/** 在桌面客户端里（自己就是装好的 App：系统通知由它弹，站外链接开进它的网页标签）。 */
export function inDesktopApp(): boolean {
  return hostKind() === 'desktop';
}

/**
 * 网页标签（原生网页）；没有是 null：网页在新窗口打开。壳往回报的事件（window.__plasticineWebTabEvent，协议在
 * agent/shared/api/mac-bridge.ts 的 WebTabEvent）里有「标签图标变了」（icon：这个标签页面自己的 favicon），界面拿它
 * 画竖排标签的网站图标（shell/site-icon.tsx）；壳不报时界面用本体代取的。
 */
export function hostWebTabs(): PlasticineMacWebTabs | null {
  return bridge()?.webTabs ?? window.plasticineIOS?.webTabs ?? null;
}

/** 窗口外观（交通灯、窗口按钮、顶栏拖动区）；没有是 null。 */
export function hostWindowChrome(): PlasticineMacWindowChrome | null {
  return bridge()?.windowChrome ?? null;
}

/** 网页的沉浸式翻译；没有是 null。 */
export function hostTranslate(): PlasticineMacTranslate | null {
  return bridge()?.translate ?? window.plasticineIOS?.translate ?? null;
}

/** 这台电脑上网页标签的登录（从 Chrome / Safari 搬一次）；没有是 null。 */
export function hostLogins(): PlasticineMacLogins | null {
  return bridge()?.logins ?? null;
}

/** 壳上可能挂着的 Electron 新几样（agent/shared/api/desktop-bridge.ts）；旧 Swift App 没有。 */
type DesktopExtras = { server?: Partial<PlasticineDesktopServer>; external?: Partial<PlasticineDesktopExternal> };

function extras(): DesktopExtras | undefined {
  return bridge() as DesktopExtras | undefined;
}

/**
 * 本机令牌（首次使用流程，11-08）：窗口载入的是壳自己拉起的本机本体时有；连远程、旧 App、网页里是 null。
 * 壳读不出来时也当没有（建账号、改密码改走别的路，界面就地说一句）。
 */
export async function hostLocalGrant(): Promise<string | null> {
  const server = extras()?.server;
  if (server?.localGrant === undefined) {
    return null;
  }
  try {
    const token = await server.localGrant();
    return typeof token === 'string' && token !== '' ? token : null;
  } catch (cause) {
    console.warn('桌面客户端没给本机令牌', cause);
    return null;
  }
}

/** 回到桌面客户端的开始页（「换一个地方」）；不在桌面客户端里是 null。 */
export function hostShowWelcome(): (() => void) | null {
  const server = extras()?.server;
  const show = server?.showWelcome;
  return show === undefined ? null : () => show.call(server);
}

/** 交给系统浏览器、在本机等一次 OAuth 回调（模型订阅登录）；不在桌面客户端里是 null。 */
export function hostExternal(): PlasticineDesktopExternal | null {
  const external = extras()?.external;
  if (external?.open === undefined || external.capture === undefined || external.cancelCapture === undefined) {
    return null;
  }
  return external as PlasticineDesktopExternal;
}

/** 桌面壳里的设备助手（Electron 壳才有）；没有是 null。 */
export function hostHelper(): DesktopHelperBridge | null {
  return bridge()?.helper ?? null;
}

/** 弹系统通知（点了打开 hash）。没有壳时抛错，调用方说明没发出。 */
export function hostNotify(title: string, body: string, hash: string): void {
  const desktop = bridge();
  if (desktop === undefined) {
    throw new Error('桌面客户端的通知还没就绪');
  }
  desktop.notify(title, body, hash);
}

/** 旧 iPhone 壳的原生页面（设置与自检、拍照、语音）；没有是 null。 */
export function hostIosPages(): PlasticineIOSBridge | null {
  return window.plasticineIOS ?? null;
}
