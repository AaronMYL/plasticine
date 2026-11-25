import { clientProfile, type ClientName, type ClientProfile } from './client-profile.ts';
import { fakeNativeConfig, fakeNativeScript } from './fake-native.ts';

export interface CdpPage {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

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
