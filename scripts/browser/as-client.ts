// 把一个刚开的空白页装成客户端：User-Agent、窗口大小、触屏与否、模拟的原生桥。要在导航之前做，网页第一行脚本
// 跑起来时就已经是客户端（web-gate.ts 认 User-Agent 和桥；mac/bridge.ts）。
// 有鼠标（hover: hover、pointer: fine）在启动浏览器时定（cdp.ts 的 MOUSE_FLAGS）：CDP 的 setEmulatedMedia 改不了
// hover / pointer，只有触屏模拟能把它切成 hover: none、pointer: coarse，所以手机开触屏、电脑不开。

import { clientProfile, type ClientName, type ClientProfile } from './client-profile.ts';
import { fakeNativeConfig, fakeNativeScript } from './fake-native.ts';

/** 能发 CDP 命令的页面（cdp.ts 的 Cdp）。 */
export interface CdpPage {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** 手机触屏最多几指：和 iPhone 一样报 5。 */
const PHONE_TOUCH_POINTS = 5;

export async function prepareClient(page: CdpPage, client: ClientName | ClientProfile): Promise<ClientProfile> {
  const profile = typeof client === 'string' ? clientProfile(client) : client;
  await page.send('Page.enable');
  await page.send('Emulation.setUserAgentOverride', { userAgent: profile.userAgent, platform: profile.platform });
  await page.send('Emulation.setDeviceMetricsOverride', { width: profile.width, height: profile.height,
    deviceScaleFactor: 1, mobile: profile.mobile });
  if (profile.touch) {
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: PHONE_TOUCH_POINTS });
  }
  const config = fakeNativeConfig(profile);
  if (config !== null) {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeNativeScript(config) });
  }
  return profile;
}
