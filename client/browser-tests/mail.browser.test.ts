// 邮件按原样显示的真实浏览器验收（用户 2026-11-04 定）：真服务端 + 真 Chromium。消息里点开一个邮件地址，最新一封是整宽阅读区，
// HTML 进沙箱 iframe（没有 allow-scripts），内嵌图（cid → data:）和远程图（经服务端代理、带签名）都显示出来，信里的脚本
// 没跑，iframe 高度跟着内容；纯文字的旧信点开是段落。远程图服务器在本机回环上，只在这条测试里放行回环地址。
// PLASTICINE_BROWSER_EVIDENCE=<目录> 时另存四个尺寸 × 浅 / 深八张截图。

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { isPrivateHost } from '../../agent/src/cloud-tools/urls.ts';
import { pair, startTestApp } from '../../agent/tests/app/helpers.ts';
import { launchBrowser, type Cdp } from '../../scripts/browser/cdp.ts';

const PNG_RED = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFTEMLQkAy7Q/wQ7IdWMAAAAASUVORK5CYII=';

async function until(done: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!await done()) {
    if (Date.now() > deadline) {
      throw new Error(`邮件浏览器验收等待失败：${label}`);
    }
    await pause(50);
  }
}

async function screenshots(page: Cdp, prefix: string): Promise<void> {
  const directory = process.env['PLASTICINE_BROWSER_EVIDENCE'];
  if (directory === undefined) {
    return;
  }
  await mkdir(directory, { recursive: true });
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [500, 500]]) {
    for (const theme of ['light', 'dark']) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await pause(300);
      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(directory, `${prefix}-${width}-${theme}.png`), Buffer.from(String(shot['data']), 'base64'));
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1,
    mobile: false });
  // 手机和桌面阅读区会重新挂载；取证结束后不能点到即将被替换的手机组件。
  await until(() => page.evaluate(`(async () => {
    const reader = document.querySelector('.contacts-main .mail-reader[data-phone="false"]');
    const target = reader?.querySelector('.mail-reader-other');
    if (innerWidth !== 1440 || !target) return false;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return reader === document.querySelector('.contacts-main .mail-reader[data-phone="false"]')
      && target.isConnected && target === reader.querySelector('.mail-reader-other');
  })()`), '截图后桌面邮件阅读区稳定');
}

test('邮件：整宽阅读区、沙箱 iframe、内嵌图和代理远程图都显示、脚本不跑、高度随内容；纯文字的旧信是段落', async (t) => {
  let remoteHits = 0;
  const images = createHttpServer((_req, res) => {
    remoteHits += 1;
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from(PNG_RED, 'base64'));
  });
  await new Promise<void>((resolve) => images.listen(0, '127.0.0.1', resolve));
  t.after(() => images.close());
  const imagePort = (images.address() as { port: number }).port;
  const app = await startTestApp([], { startTasks: false, mailImages: {
    resolve: async (host) => [{ address: host === 'img.test' ? '127.0.0.1' : host, family: 4 }],
    blocked: (address) => address !== '127.0.0.1' && isPrivateHost(address),
  } });
  t.after(async () => { await app.close(); });
  const now = app.clock.now().getTime();
  const old = app.state.inboxMessages.add({ source: 'email', fromAddress: 'news@example.test', fromName: '周报',
    title: '上周的纯文字信', body: '第一段\n\n第二段 https://example.test/a', messageId: '<old@example.test>',
    receivedAt: new Date(now - 2 * 86_400_000).toISOString() }).message;
  const rich = app.state.inboxMessages.add({ source: 'email', fromAddress: 'news@example.test', fromName: '周报',
    title: '本周精选：排版和图片都在', body: '本周精选', messageId: '<rich@example.test>',
    receivedAt: new Date(now - 3_600_000).toISOString(),
    bodyHtml: '<table width="100%" style="background:#f4f1ea"><tr><td style="padding:24px">'
      + '<h1 style="color:#a15b3d;font-family:Georgia,serif">本周精选</h1>'
      + '<p>内嵌图：<img id="inline" src="cid:logo@x" width="32" height="32"></p>'
      + `<p>远程图：<img id="remote" src="http://img.test:${imagePort}/hero.png" width="64" height="64"></p>`
      + '<p>' + '正文很长的一段。'.repeat(80) + '</p>'
      + '<p><a href="https://example.test/read">读全文</a></p></td></tr></table>' }).message;
  await mkdir(join(app.directory, 'mail', 'parts', rich.id), { recursive: true });
  await writeFile(join(app.directory, 'mail', 'parts', rich.id, '0'), Buffer.from(PNG_RED, 'base64'));
  app.state.inboxMailParts.add({ messageId: rich.id, contentId: 'logo@x', filename: 'logo.png', type: 'image/png',
    size: Buffer.from(PNG_RED, 'base64').length, path: `mail/parts/${rich.id}/0` });

  const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error',
    server: { hmr: false, host: '127.0.0.1', port: 0, proxy: { '/v2': { target: app.base } } } });
  await vite.listen();
  t.after(async () => { await vite.close(); });
  const address = vite.httpServer?.address();
  assert.ok(address !== null && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); });
  const hash = `#/messages/${encodeURIComponent('mail:news@example.test')}`;
  const page = await browser.page(`${base}/browser-tests/fixtures/feed.html${hash}`);
  const [name, value] = (await pair(app)).split('=');
  await page.send('Network.setCookie', { name, value, url: base });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1,
    mobile: false });
  await page.send('Page.reload');

  const frame = 'document.querySelector(".mail-reader iframe")';
  await until(() => page.evaluate(`Boolean(${frame}?.contentDocument?.getElementById("remote"))`), '阅读区 iframe');
  assert.equal(await page.evaluate(`${frame}.getAttribute('sandbox').includes('allow-scripts')`), false);
  assert.equal(await page.evaluate('Boolean(document.querySelector(".cm-bubble"))'), false);
  const image = (id: string) => `${frame}.contentDocument.getElementById(${JSON.stringify(id)})`;
  await until(() => page.evaluate(`${image('inline')}.complete && ${image('inline')}.naturalWidth === 8`), '内嵌图');
  await until(() => page.evaluate(`${image('remote')}.complete && ${image('remote')}.naturalWidth === 8`), '代理图');
  assert.match(String(await page.evaluate(`${image('inline')}.src`)), /^data:image\/png;base64,/);
  assert.match(String(await page.evaluate(`${image('remote')}.src`)), new RegExp(`^${base}/v2/mail-image\\?u=`));
  assert.equal(remoteHits, 1);
  // 高度跟着内容：iframe 里没有自己的滚动条。
  await until(() => page.evaluate(`${frame}.getBoundingClientRect().height > 400`), 'iframe 高度随内容');
  assert.equal(await page.evaluate(`Math.abs(${frame}.getBoundingClientRect().height
    - ${frame}.contentDocument.documentElement.getBoundingClientRect().height) <= 2`), true);
  assert.equal(await page.evaluate(`getComputedStyle(${frame}.contentDocument.body).backgroundColor`),
    'rgb(255, 255, 255)');
  // 阅读区是整宽的：占满阅读区这一栏（最宽 720，减去两边留白），不是气泡的那一截。
  assert.equal(await page.evaluate(`(() => {
    const column = document.querySelector('.mail-reader-page');
    const style = getComputedStyle(column);
    const inner = column.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return Math.abs(${frame}.getBoundingClientRect().width - inner) <= 2;
  })()`), true);
  await screenshots(page, 'mail-html');

  await page.evaluate(`Array.from(document.querySelectorAll('.mail-reader-other'))
    .find((button) => button.textContent.includes('上周的纯文字信')).click()`);
  await until(() => page.evaluate(`document.querySelectorAll('.mail-reader .mail-text p').length === 2`),
    '纯文字段落');
  assert.equal(await page.evaluate(`document.querySelector('.mail-text a').getAttribute('href')`),
    'https://example.test/a');
  assert.equal(old.id.length > 0, true);
});
