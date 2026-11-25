import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session } from 'electron';
import { renderRequestAllowed, shotSize } from './page-render-rules.ts';

export type PageFormat = 'pdf' | 'png';

export const SHOT_WIDTH = 1200;
const SETTLE_MS = 400;
const RENDER_TIMEOUT_MS = 60_000;
const PARTITION = 'plasticine-render';
const READY = `Promise.all([document.fonts.ready,
  ...Array.from(document.images, (image) => image.decode().catch(() => null))])
  .then(() => new Promise((resolve) => setTimeout(resolve, ${SETTLE_MS})))
  .then(() => Math.ceil(document.documentElement.scrollHeight))`;

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
