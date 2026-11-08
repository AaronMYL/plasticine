// 无人观看时清掉手机模拟并调整真实内容区；脑始终从桌面尺寸继续，不改 User-Agent。
import type { BrowserViewport } from '../../shared/api/browser.ts';
import type { CdpConnection } from './cdp-connection.ts';
import { cdpValue, CdpWindowSchema } from './cdp-protocol.ts';

const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 800;
const MOBILE_BELOW = 768;
const MAX_DPR = 2;
const MAX_ENCODED_EDGE = 2000;

export function viewportMetrics(viewport: BrowserViewport) {
  return { width: viewport.width, height: viewport.height,
    deviceScaleFactor: Math.min(viewport.deviceScaleFactor ?? 1, MAX_DPR), mobile: viewport.width < MOBILE_BELOW };
}

export function encodedSize(viewport: BrowserViewport): { maxWidth: number; maxHeight: number } {
  const metrics = viewportMetrics(viewport);
  const scale = Math.min(metrics.deviceScaleFactor, MAX_ENCODED_EDGE / Math.max(metrics.width, metrics.height));
  return { maxWidth: Math.max(1, Math.floor(metrics.width * scale)),
    maxHeight: Math.max(1, Math.floor(metrics.height * scale)) };
}

export async function restoreDesktop(connection: CdpConnection, sessionId: string, signal: AbortSignal): Promise<void> {
  await connection.send('Emulation.clearDeviceMetricsOverride', {}, signal, sessionId);
  const window = cdpValue(CdpWindowSchema, await connection.send('Browser.getWindowForTarget', {}, signal, sessionId));
  await connection.send('Browser.setContentsSize', { windowId: window.windowId,
    width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT }, signal);
}
