// 云端浏览器（真实 Chromium）：线按观察坐标点击、标签按线固定、过期画面拒绝。2026-11-05 Harness 重做后
// 旧的回合循环和回执账删了，这里直接驱动 CloudBrowser，核对它自己的约束。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { Cdp, launchBrowser, type LocalBrowser } from '../../scripts/browser/cdp.ts';
import { CloudBrowser, CdpBrowser } from '../../agent/src/cloud-tools/index.ts';

async function until(ready: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (!await ready()) {
    if (Date.now() >= deadline) { throw new Error(`真实浏览器工具页面未就绪：${label}`); }
    await pause(40);
  }
}

test('真实 Chromium：线看图、按观察坐标点击、标签按线固定、过期画面拒绝',
  { timeout: 60_000 }, async (t) => {
  let local: LocalBrowser | undefined;
  let cloud: CloudBrowser | undefined;
  let page: Cdp | undefined;
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><head><title>Local Harness Fixture</title>
      <style>body{font:20px sans-serif;padding:30px}button{width:200px;height:60px}</style></head>
      <body><h1>Local Harness</h1><button aria-label="Increase count">Increase count</button>
      <p id="count">Clicks: 0</p><script>window.clickCount=0;
      document.querySelector('button').onclick=()=>{window.clickCount+=1;
        document.querySelector('#count').textContent='Clicks: '+window.clickCount;};
      document.documentElement.dataset.ready='yes';</script></body></html>`);
  });
  t.after(async () => {
    cloud?.close(); page?.close(); await local?.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address(); assert.ok(address !== null && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/task`;
  local = await launchBrowser();
  const browser = cloud = new CloudBrowser({ transport: new CdpBrowser({ endpoint: local.endpoint }),
    now: () => new Date() });
  const line = 'line:line-main';
  const signal = AbortSignal.timeout(35_000);
  const opened = await browser.open(url, signal, line);
  const tabId = opened.activeTabId;
  assert.ok(tabId);
  const targets = await fetch(`${local.endpoint}/json/list`)
    .then((response) => response.json()) as { id: string; webSocketDebuggerUrl: string }[];
  const target = targets.find((entry) => entry.id === tabId);
  assert.ok(target);
  page = await Cdp.connect(target.webSocketDebuggerUrl);
  await until(() => page!.evaluate(`location.href === ${JSON.stringify(url)}
    && document.readyState === 'complete' && document.documentElement.dataset.ready === 'yes'`), 'ready');
  const before = await browser.observe(signal, line);
  assert.equal(before.tabId, tabId);
  assert.match(before.page.text, /Clicks: 0/);
  const png = before.image;
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(png.readUInt32BE(16) > 100 && png.readUInt32BE(20) > 100, '实际页面尺寸的 PNG');
  const directory = process.env['PLASTICINE_BROWSER_EVIDENCE'];
  if (directory !== undefined) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'cloud-browser-before.png'), png);
  }
  const button = before.page.elements.find((element) => element.label === 'Increase count');
  assert.ok(button && button.bounds.width > 2 && button.bounds.height > 2 && !button.disabled);
  const click = { kind: 'click' as const, x: Math.round(button.bounds.x + button.bounds.width / 2),
    y: Math.round(button.bounds.y + button.bounds.height / 2) };
  await browser.act(click, signal, line, before.id);
  await until(() => page!.evaluate('window.clickCount === 1'), '第一次点击');
  const other = await browser.open(url.replace('/task', '/other'), signal, 'line:other');
  assert.notEqual(other.activeTabId, tabId, '另一条线用自己的标签');
  const after = await browser.observe(signal, line);
  assert.equal(after.tabId, tabId, '观察回到这条线自己的标签');
  assert.match(after.page.text, /Clicks: 1/);
  assert.notEqual(after.id, before.id);
  await assert.rejects(browser.act({ ...click, x: click.x + 1 }, signal, line, before.id), /重新观察|新画面/);
  assert.equal(await page.evaluate('window.clickCount'), 1, '过期观察没有发出第二次点击');
});
