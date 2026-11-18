// 打印成 PDF（11-16）：借云端浏览器，隔离的上下文、后台标签，HTML 直接放进页面，按流读回，最后关掉标签和上下文；
// 打印用的标签不进云端浏览器的标签列表。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CdpBrowser, printPdf, renderPage } from '../../src/cloud-tools/index.ts';
import { fakeCdp } from './fake-cdp.ts';

test('printPdf：HTML 放进隔离的后台标签，按流读回 PDF，读和关都带标签的会话，最后关标签和上下文', async () => {
  const cdp = await fakeCdp();
  try {
    const pdf = await printPdf('<p>你好</p>', AbortSignal.timeout(5_000), cdp.endpoint);
    assert.equal(pdf.toString('utf8'), '%PDF-1.4 假的');
    const methods = cdp.commands.map((command) => command.method);
    assert.deepEqual(methods, ['Target.createBrowserContext', 'Target.createTarget', 'Target.attachToTarget',
      'Page.getFrameTree', 'Page.setDocumentContent', 'Runtime.evaluate', 'Page.printToPDF', 'IO.read', 'IO.read',
      'IO.close', 'Target.closeTarget', 'Target.disposeBrowserContext']);
    const create = cdp.commands.find((command) => command.method === 'Target.createTarget');
    assert.equal(create?.params['browserContextId'], 'context-1');
    assert.equal(create?.params['background'], true);
    const set = cdp.commands.find((command) => command.method === 'Page.setDocumentContent');
    assert.equal(set?.params['html'], '<p>你好</p>');
    for (const read of cdp.commands.filter((command) => command.method.startsWith('IO.'))) {
      assert.equal(read.sessionId, 'session-tab-2');
    }
  } finally {
    await cdp.close();
  }
});

test('打印用的标签不进云端浏览器的标签列表', async () => {
  const cdp = await fakeCdp();
  const browser = new CdpBrowser({ endpoint: cdp.endpoint });
  try {
    const signal = AbortSignal.timeout(5_000);
    cdp.hold('Page.printToPDF');
    const printing = printPdf('<p>x</p>', signal, cdp.endpoint);
    while (!cdp.commands.some((command) => command.method === 'Page.printToPDF')) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const snapshot = await browser.snapshot(signal);
    assert.deepEqual(snapshot.tabs.map((tab) => tab.id), ['tab-1']);
    cdp.release();
    await printing;
  } finally {
    browser.close();
    await cdp.close();
  }
});

test('renderPage 出长图：宽 1200，视口拉到整页那么高再截，不太长的用两倍清晰度', async () => {
  const cdp = await fakeCdp();
  try {
    const png = await renderPage('<p>长图</p>', 'png', AbortSignal.timeout(5_000), cdp.endpoint);
    assert.equal(png.toString('utf8'), 'png');
    const metrics = cdp.commands.filter((command) => command.method === 'Emulation.setDeviceMetricsOverride')
      .map((command) => command.params);
    assert.deepEqual(metrics, [{ width: 1200, height: 900, deviceScaleFactor: 1, mobile: false },
      { width: 1200, height: 3000, deviceScaleFactor: 2, mobile: false }]);
    const methods = cdp.commands.map((command) => command.method);
    assert.equal(methods.includes('Page.printToPDF'), false);
    assert.deepEqual(methods.slice(-3),
      ['Page.captureScreenshot', 'Target.closeTarget', 'Target.disposeBrowserContext']);
  } finally {
    await cdp.close();
  }
});
