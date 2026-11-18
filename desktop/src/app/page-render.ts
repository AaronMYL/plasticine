// 资料库导出成 PDF、长图（11-18，用户：「本地不就是一个 electron 浏览器框架吗？」）：界面把拼好的整页网页交过来，
// 壳开一个看不见的窗口（单独的内存 session，不连网：只放行 data:、blob:、about: 和这一页自己的临时文件）载入它，
// 等字体、图片和页面脚本画的图表好了：PDF 用 printToPDF（A4，带背景），长图借调试协议把视口拉到整页高再截一张。
// 页面先写进临时目录再载入（大页面不塞进 data: 地址），用完窗口和文件都收掉。

import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session } from 'electron';
import { renderRequestAllowed, shotSize } from './page-render-rules.ts';

export type PageFormat = 'pdf' | 'png';

/** 长图的宽（资料库的报告按 1120 宽排）。 */
export const SHOT_WIDTH = 1200;
/** 字体、图片好了以后再等这么久（图表靠页面脚本画）。 */
const SETTLE_MS = 400;
/** 整个出一页最多等这么久。 */
const RENDER_TIMEOUT_MS = 60_000;
const PARTITION = 'plasticine-render';
const READY = `Promise.all([document.fonts.ready,
  ...Array.from(document.images, (image) => image.decode().catch(() => null))])
  .then(() => new Promise((resolve) => setTimeout(resolve, ${SETTLE_MS})))
  .then(() => Math.ceil(document.documentElement.scrollHeight))`;

/** 正在出的几页的临时文件地址：只有它们能载入。 */
const pages = new Set<string>();
let guarded = false;

function renderSession(): Electron.Session {
  const target = session.fromPartition(PARTITION);
  if (!guarded) {
    guarded = true;
    target.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !renderRequestAllowed(details.url, pages) }));
    target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  }
  return target;
}

async function capture(window: BrowserWindow, height: number): Promise<Buffer> {
  const { height: shot, scale } = shotSize(height);
  const tool = window.webContents.debugger;
  tool.attach('1.3');
  try {
    await tool.sendCommand('Emulation.setDeviceMetricsOverride', { width: SHOT_WIDTH, height: shot,
      deviceScaleFactor: scale, mobile: false });
    const result: unknown = await tool.sendCommand('Page.captureScreenshot', { format: 'png' });
    const data: unknown = typeof result === 'object' && result !== null ? Reflect.get(result, 'data') : undefined;
    if (typeof data !== 'string') throw new Error('截图没有回图');
    return Buffer.from(data, 'base64');
  } finally {
    tool.detach();
  }
}

/** 一页网页出成 PDF 或长图的字节。 */
export async function renderPage(html: string, format: PageFormat): Promise<Buffer> {
  const file = join(tmpdir(), `plasticine-render-${randomUUID()}.html`);
  const url = pathToFileURL(file).href;
  await writeFile(file, html, { mode: 0o600 });
  pages.add(url);
  const window = new BrowserWindow({ show: false, width: SHOT_WIDTH, height: 900, enableLargerThanScreen: true,
    webPreferences: { session: renderSession(), sandbox: true, contextIsolation: true, nodeIntegration: false,
      javascript: true, webSecurity: true } });
  const timer = setTimeout(() => window.destroy(), RENDER_TIMEOUT_MS);
  try {
    await window.loadURL(url);
    const height: unknown = await window.webContents.executeJavaScript(READY, true);
    if (format === 'pdf') {
      return await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    }
    return await capture(window, typeof height === 'number' ? height : 900);
  } finally {
    clearTimeout(timer);
    if (!window.isDestroyed()) window.destroy();
    pages.delete(url);
    await rm(file, { force: true });
  }
}
