// 一次性截图：自己的本地 Vite 和临时浏览器均在 finally 中关闭，没有常驻服务。
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer } from 'vite';
import { launchBrowser, type Cdp, type LocalBrowser } from './cdp.ts';
import { CdpBrowser, encodedSize } from '../../agent/src/cloud-tools/index.ts';
import type { BrowserFrame, BrowserViewport } from '../../agent/shared/api/browser.ts';

const directory = resolve(process.argv[2] ?? 'C:/Plasticine/screenshots/m6b');
const server = await createServer({ root: resolve('client'), logLevel: 'error', configLoader: 'runner',
  cacheDir: join(tmpdir(), 'plasticine-m6b-vite'),
  server: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser: LocalBrowser | undefined;
let remote: LocalBrowser | undefined;
let transport: CdpBrowser | undefined;
async function wait(page: Cdp, expression: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (await page.evaluate<boolean>(expression)) {
      return;
    }
    await pause(100);
  }
  throw new Error('本地截图页面未就绪');
}

async function picture(page: Cdp, viewport: BrowserViewport): Promise<void> {
  if (transport === undefined) {
    throw new Error('本地 CDP 未连接');
  }
  let frame: BrowserFrame | undefined;
  const cast = await transport.watch(viewport, (next) => { frame = next; },
    () => { throw new Error('本地截图 CDP 断线'); }, AbortSignal.timeout(10_000));
  try {
    for (let index = 0; frame === undefined && index < 100; index += 1) {
      await pause(100);
    }
    if (frame === undefined) {
      throw new Error('本地 CDP 没有送来画面');
    }
    await page.evaluate(`window.m6b.emitFrame(${JSON.stringify(frame)})`);
    const expected = encodedSize(viewport);
    try {
      // CDP 将缩放后的非整数短边取整，最多相差一个编码像素；CSS 视口仍严格相等。
      await wait(page, `document.querySelector('.browser-canvas')?.width === ${expected.maxWidth}
        && Math.abs(document.querySelector('.browser-canvas')?.height - ${expected.maxHeight}) <= 1`);
    } catch {
      const actual = await page.evaluate<{ width: number; height: number }>(`(() => {
        const canvas = document.querySelector('.browser-canvas');
        return { width: canvas?.width, height: canvas?.height };
      })()`);
      throw new Error(`画面尺寸 ${actual.width}×${actual.height}，预期 ${expected.maxWidth}×${expected.maxHeight}`);
    }
    await cast.ack(frame.sequence);
    console.log(`CSS ${viewport.width}×${viewport.height}，编码 ${expected.maxWidth}×${expected.maxHeight}`);
  } finally {
    await cast.close();
  }
}

try {
  await mkdir(directory, { recursive: true });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === undefined || address === null || typeof address === 'string') {
    throw new Error('本地 Vite 没有监听端口');
  }
  browser = await launchBrowser();
  remote = await launchBrowser();
  const base = `http://127.0.0.1:${address.port}/browser-tests/fixtures/`;
  // 被观看的网站开在普通浏览器里（它是外面的网站，不是 Plasticine 客户端）。
  const site = await remote.page(`${base}m6b-site.html`, 'web');
  await wait(site, 'document.readyState === "complete"');
  await site.evaluate('document.fonts.ready.then(() => true)');
  transport = new CdpBrowser({ endpoint: remote.endpoint });
  const snapshot = await transport.snapshot(AbortSignal.timeout(10_000));
  const target = snapshot.tabs.find((tab) => tab.url === `${base}m6b-site.html`);
  if (target === undefined) {
    throw new Error('没有找到响应式模拟网站');
  }
  await transport.tab({ kind: 'switch', tabId: target.id }, AbortSignal.timeout(10_000));
  const cases = [
    { width: 1440, height: 900, theme: 'light', brain: false },
    { width: 1440, height: 900, theme: 'dark', brain: false },
    { width: 768, height: 1024, theme: 'light', brain: false },
    { width: 768, height: 1024, theme: 'dark', brain: false },
    { width: 500, height: 500, theme: 'light', brain: false },
    { width: 500, height: 500, theme: 'dark', brain: false },
    { width: 390, height: 844, theme: 'light', brain: false },
    { width: 390, height: 844, theme: 'dark', brain: false },
    { width: 1440, height: 900, theme: 'light', brain: true },
  ];
  for (const { width, height, theme, brain } of cases) {
    const phone = width < 768;
    const page = await browser.page(`${base}m6b.html`);
    await page.send('Emulation.setDeviceMetricsOverride', { width, height,
      deviceScaleFactor: 1, mobile: phone });
    await page.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-color-scheme', value: theme },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ] });
    await site.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    if (phone) {
      const more = '[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "更多")';
      const tool = '[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "浏览器")';
      await wait(page, `Boolean(${more})`);
      await page.evaluate(`${more}.click()`);
      await wait(page, `Boolean(${tool})`);
      await page.evaluate(`${tool}.click()`);
    } else {
      await wait(page, 'Boolean(document.querySelector("[aria-label=工具]"))');
      await page.evaluate('document.querySelector("[aria-label=工具]").click()');
      await wait(page, 'Boolean(document.querySelector("[aria-label=浏览器]"))');
      await page.evaluate('document.querySelector("[aria-label=浏览器]").click()');
    }
    await wait(page, 'window.m6b?.viewport !== null && Boolean(document.querySelector(".browser-canvas"))');
    await page.evaluate(`window.m6b.controller('${brain ? 'brain' : 'idle'}')`);
    await page.evaluate('document.fonts.ready.then(() => true)');
    await pause(400);
    const viewport = await page.evaluate<BrowserViewport>('window.m6b.viewport');
    await picture(page, viewport);
    const restored = await site.evaluate<{ width: number; height: number }>(
      '({ width: innerWidth, height: innerHeight })');
    if (restored.width !== 1280 || restored.height !== 800) {
      throw new Error('关闭观看后没有恢复 1280×800 桌面');
    }
    const overflow = await page.evaluate<boolean>('document.documentElement.scrollWidth > innerWidth');
    if (overflow) {
      throw new Error(`${width} 页面横向溢出`);
    }
    const fills = await page.evaluate<boolean>(`(() => {
      const rect = document.querySelector('.browser-surface').getBoundingClientRect();
      return Math.abs(rect.bottom - innerHeight) < 1 && Math.abs(rect.right - innerWidth) < 1
        && Math.abs(rect.width - window.m6b.viewport.width) < 1;
    })()`);
    if (!fills) {
      throw new Error(`${width} 的浏览器没有填满主栏`);
    }
    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = join(directory, `browser-${width}-${theme}${brain ? '-brain' : ''}.png`);
    await writeFile(file, Buffer.from(String(shot['data']), 'base64'));
    console.log(file);
    // 手机与高 DPR 桌面的真实 CDP 编码也核对一次，截图仍保留用户要求的 CSS 尺寸。
    if (theme === 'light' && !brain) {
      await picture(page, { ...viewport, deviceScaleFactor: 2 });
    }
    await page.send('Page.close');
    page.close();
  }
} finally {
  transport?.close();
  try {
    await remote?.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
}
