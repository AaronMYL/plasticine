import type { BrowserFrame, BrowserViewport } from '../../shared/api/browser.ts';
import type { CdpConnection } from './cdp-connection.ts';
import { cdpValue, CdpDataSchema, CdpFrameSchema, CdpLayoutSchema } from './cdp-protocol.ts';
import type { BrowserWatch } from './transports.ts';
import { encodedSize, restoreDesktop, viewportMetrics } from './cdp-viewport.ts';

// M6：JPEG 70，CSS 视口随观看区域变化，编码按 DPR（最多 2）且长边不超过 2000。
const JPEG_QUALITY = 70;
const STREAM_COMMAND_MS = 5_000;

export async function screencast(options: BrowserViewport & {
  connection: CdpConnection; sessionId: string; tabId: string; width: number; height: number;
  sequence: () => number; frame: (frame: BrowserFrame) => void; failed: () => void; signal: AbortSignal;
}): Promise<BrowserWatch> {
  const { connection, sessionId, tabId, signal } = options;
  let pending: { sequence: number; cdpId: number | null; acknowledging: boolean } | null = null;
  let dirty = false;
  let stopped = false;
  const captures = new AbortController();
  let capturing: Promise<void> = Promise.resolve();
  const metrics = viewportMetrics(options);
  const encoded = encodedSize(options);
  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    return connection.send(method, params, AbortSignal.timeout(STREAM_COMMAND_MS), sessionId);
  };
  const capture = async (): Promise<unknown> => {
    const limited = AbortSignal.any([captures.signal, AbortSignal.timeout(STREAM_COMMAND_MS)]);
    const layout = cdpValue(CdpLayoutSchema, await connection.send('Page.getLayoutMetrics', {}, limited, sessionId));
    return connection.send('Page.captureScreenshot', { format: 'jpeg', quality: JPEG_QUALITY,
      captureBeyondViewport: false, clip: { x: layout.cssVisualViewport.pageX, y: layout.cssVisualViewport.pageY,
        width: options.width, height: options.height,
        scale: encoded.maxWidth / options.width / metrics.deviceScaleFactor } }, limited, sessionId);
  };
  const startCapture = (cdpId: number | null): void => {
    dirty = false;
    pending = { sequence: options.sequence(), cdpId, acknowledging: false };
    const sequence = pending.sequence;
    const deliver = (image: string): void => {
      if (!stopped) {
        options.frame({ sequence, tabId, data: image, width: options.width, height: options.height });
      }
    };
    // Chromium 的 screencast 不会升采样至 DPR，尺寸变化后首帧也可能仍是旧尺寸。
    // 用它通知重绘，按新视口和倍率由截图接口编码。
    // 保持同一份 pending，客户端绘制确认前既不捕下一张，也不积压帧。
    capturing = capture()
      .then((result) => deliver(cdpValue(CdpDataSchema, result).data))
      .catch(() => {
        if (!stopped) {
          options.failed();
        }
      });
  };
  const off = connection.onEvent((event) => {
    if (stopped || event.method !== 'Page.screencastFrame' || event.sessionId !== sessionId) {
      return;
    }
    const data = cdpValue(CdpFrameSchema, event.params);
    if (pending !== null) {
      // 不积压图片，但记住有新重绘；当前帧确认后即使网页已静止也会再取最新画面。
      dirty = true;
      void send('Page.screencastFrameAck', { sessionId: data.sessionId }).catch(options.failed);
      return;
    }
    startCapture(data.sessionId);
  });
  try {
    await connection.send('Emulation.setDeviceMetricsOverride', metrics, signal, sessionId);
    await connection.send('Page.startScreencast', { format: 'jpeg', quality: JPEG_QUALITY,
      ...encoded, everyNthFrame: 1 }, signal, sessionId);
  } catch (error) {
    stopped = true;
    captures.abort();
    off();
    await capturing;
    await send('Page.stopScreencast').catch(() => connection.close());
    await restoreDesktop(connection, sessionId, AbortSignal.timeout(STREAM_COMMAND_MS)).catch(() => connection.close());
    throw error;
  }
  return {
    async ack(sequence) {
      if (stopped || pending?.sequence !== sequence || pending.acknowledging) {
        return;
      }
      pending.acknowledging = true;
      const cdpId = pending.cdpId;
      if (cdpId !== null) {
        await send('Page.screencastFrameAck', { sessionId: cdpId });
      }
      if (stopped) {
        return;
      }
      pending = null;
      if (dirty) {
        startCapture(null);
      }
    },
    async close(targetGone = false) {
      if (stopped) {
        return;
      }
      stopped = true;
      pending = null;
      off();
      captures.abort();
      await capturing;
      if (!targetGone) {
        try {
          await send('Page.stopScreencast');
        } finally {
          await restoreDesktop(connection, sessionId, AbortSignal.timeout(STREAM_COMMAND_MS));
        }
      }
    },
  };
}
