// 网页工具条 ⋯ 菜单、圈一块、标签悬停预览要壳做的几样（形状照 agent/shared/api/web-page-tools.ts）：查找、缩放、截图
// （可见部分 / 整页）、打印（系统面板里能存成 PDF）、圈一块、缩略图、打开下载文件夹、感知整页。整页截图走 Chromium
// 调试协议（Page.captureScreenshot captureBeyondViewport），这是 Electron 里最稳的做法。

import { app, shell, type WebContents } from 'electron';
import { WEB_IMAGE_MAX_BYTES, WEB_THUMBNAIL_WIDTH, WEB_PAGE_TOOLS, type WebPageTool,
  type WebPageToolName } from '../../../agent/shared/api/web-page-tools.ts';
import { withDebugger } from './cdp.ts';
import type { TabViews } from './tab-views.ts';

/** 整页截图最长边（和 Mac 壳一样 16384），超过按比例缩。 */
const FULL_PAGE_EDGE_MAX = 16_384;
/** JPEG 质量从这里起，超过 10 MB 往下降。 */
const JPEG_QUALITY = [85, 70, 55, 40];

export const SHELL_TOOLS: readonly WebPageToolName[] = WEB_PAGE_TOOLS;

function jpegUnderLimit(encode: (quality: number) => Buffer): { type: 'image/jpeg'; base64: string } | null {
  for (const quality of JPEG_QUALITY) {
    const bytes = encode(quality);
    if (bytes.length <= WEB_IMAGE_MAX_BYTES) {
      return { type: 'image/jpeg', base64: bytes.toString('base64') };
    }
  }
  return null;
}

function find(contents: WebContents, query: string, backwards: boolean): Promise<{ found: boolean }> {
  return new Promise((resolve) => {
    const done = (_event: Electron.Event, result: Electron.Result): void => {
      if (result.finalUpdate) {
        contents.off('found-in-page', done);
        resolve({ found: result.matches > 0 });
      }
    };
    contents.on('found-in-page', done);
    contents.findInPage(query, { forward: !backwards, findNext: true });
  });
}

async function fullPage(contents: WebContents): Promise<{ type: 'image/jpeg'; base64: string } | null> {
  return withDebugger(contents, async (send) => {
    const metrics = await send('Page.getLayoutMetrics', {}) as { cssContentSize?: { width: number; height: number } };
    const size = metrics.cssContentSize ?? { width: 1280, height: 800 };
    const scale = Math.min(1, FULL_PAGE_EDGE_MAX / Math.max(size.width, size.height));
    for (const quality of JPEG_QUALITY) {
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height: size.height, scale } }) as { data: string };
      if (Buffer.byteLength(shot.data, 'base64') <= WEB_IMAGE_MAX_BYTES) {
        return { type: 'image/jpeg' as const, base64: shot.data };
      }
    }
    return null;
  });
}

export async function runTool(tabs: TabViews, tabId: string, tool: WebPageTool): Promise<unknown> {
  const tab = tabs.get(tabId);
  if (tab === null) {
    throw new Error('没有这个网页标签了。');
  }
  const contents = tab.view.webContents;
  switch (tool.kind) {
    case 'find':
      return find(contents, tool.query, tool.backwards);
    case 'find_clear':
      contents.stopFindInPage('clearSelection');
      return true;
    case 'zoom':
      contents.setZoomFactor(tool.factor);
      return true;
    case 'capture': {
      if (tool.scope === 'full') {
        return fullPage(contents);
      }
      const image = await contents.capturePage();
      return image.isEmpty() ? null : jpegUnderLimit((quality) => image.toJPEG(quality));
    }
    case 'print':
      contents.print({ silent: false });
      return true;
    case 'circle':
      return tabs.call(tabId, 'circle');
    case 'circle_cancel':
      return tabs.call(tabId, 'circle.cancel');
    case 'thumbnail': {
      const image = await contents.capturePage();
      if (image.isEmpty()) {
        return null;
      }
      return jpegUnderLimit((quality) => image.resize({ width: WEB_THUMBNAIL_WIDTH }).toJPEG(quality));
    }
    case 'downloads':
      await shell.openPath(app.getPath('downloads'));
      return true;
    case 'perceive':
      return tabs.call(tabId, 'operate', { request: { op: 'perceive' } });
    default:
      throw new Error('不认识的网页工具。');
  }
}
