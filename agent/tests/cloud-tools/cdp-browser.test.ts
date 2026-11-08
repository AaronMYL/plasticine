import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { CdpBrowser } from '../../src/cloud-tools/cdp-browser.ts';
import { CloudBrowser } from '../../src/cloud-tools/browser.ts';
import type { BrowserFrame } from '../../shared/api/browser.ts';
import type { BrowserAction, BrowserSnapshot, BrowserTransport } from '../../src/cloud-tools/transports.ts';
import { fakeCdp } from './fake-cdp.ts';
import { CloudToolError } from '../../src/cloud-tools/index.ts';

const signal = () => AbortSignal.timeout(3_000);

test('自身会话先写入精确站点 Cookie，再导航；不清理外部网站登录，也不把令牌放进网址或返回值', async (t) => {
  const fake = await fakeCdp();
  const cookie = { name: 'plasticine_session', value: 'internal-test-token', url: 'https://plasticine.test/',
    path: '/', httpOnly: true, secure: true, sameSite: 'Strict' as const, expires: 2_000_000_000 };
  const browser = new CdpBrowser({ endpoint: fake.endpoint, internalCookies: () => [cookie],
    internalUrl: 'https://plasticine.test/' });
  t.after(async () => { browser.close(); await fake.close(); });
  const page = await browser.open('https://plasticine.test/#/notes', signal());
  const set = fake.commands.findIndex((command) => command.method === 'Storage.setCookies');
  const navigate = fake.commands.findIndex((command) => command.method === 'Page.navigate');
  assert.ok(set >= 0 && set < navigate);
  assert.deepEqual(fake.commands[set]!.params['cookies'], [cookie]);
  assert.equal(fake.commands.some((command) => command.method.startsWith('Storage.clear')), false);
  assert.equal(JSON.stringify(page).includes(cookie.value), false);
  assert.deepEqual(fake.commands[navigate]!.params, { url: 'https://plasticine.test/#/notes' });
  const written = fake.commands.filter((command) => command.method === 'Storage.setCookies').length;
  await browser.act(page.sessionId, { kind: 'type', text: '来自系统浏览器' }, signal());
  assert.ok(fake.commands.filter((command) => command.method === 'Storage.setCookies').length > written,
    '每次受控操作重新覆盖本站 Cookie，导入或网页自身换成用户 Cookie 后也不能冒名');
});
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (ready()) {
      return;
    }
    await pause(10);
  }
  assert.fail('没有等到假 CDP 的事件');
}

for (const method of ['Target.attachToTarget', 'Page.getFrameTree', 'Page.enable', 'Browser.setContentsSize']) {
  test(`初次观看与输入共享完整会话初始化，等待 ${method} 时不提前发送输入`, async (t) => {
    const fake = await fakeCdp();
    const browser = new CdpBrowser({ endpoint: fake.endpoint });
    t.after(async () => {
      browser.close();
      await fake.close();
    });
    fake.hold(method);
    const watching = browser.watch({ width: 390, height: 700 }, () => {}, () => {}, signal());
    const result = watching.then((watch) => watch.close());
    await until(() => fake.commands.some((command) => command.method === method));
    const typing = browser.act('tab-1', { kind: 'type', text: '等待初始化' }, signal());
    try {
      await pause(30);
      assert.equal(fake.commands.filter((command) => command.method === 'Target.attachToTarget').length, 1);
      assert.equal(fake.commands.some((command) => command.method === 'Input.insertText'), false);
    } finally {
      fake.release();
      await Promise.all([result, typing]);
    }
  });
}

test('会话初始化失败后清理半成品，下一次输入重新完成初始化', async (t) => {
  const fake = await fakeCdp();
  const browser = new CdpBrowser({ endpoint: fake.endpoint });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  fake.hold('Page.getFrameTree');
  const controller = new AbortController();
  const first = assert.rejects(browser.act('tab-1', { kind: 'type', text: '不能发送' }, controller.signal));
  await until(() => fake.commands.some((command) => command.method === 'Page.getFrameTree'));
  controller.abort();
  await first;
  fake.release();
  await browser.act('tab-1', { kind: 'type', text: '重新初始化' }, signal());
  assert.equal(fake.commands.filter((command) => command.method === 'Page.getFrameTree').length, 2);
  assert.ok(fake.commands.some((command) => command.method === 'Browser.setContentsSize'));
});

test('输入发送后重连失败报告未知，发送前连接失败仍报告未配置', async (t) => {
  const fake = await fakeCdp();
  const browser = new CdpBrowser({ endpoint: fake.endpoint });
  t.after(() => browser.close());
  await browser.open('https://example.com/', signal());
  const snapshot = browser.snapshot.bind(browser);
  t.mock.method(browser, 'snapshot', async (limited: AbortSignal) => {
    browser.disconnect();
    await fake.close();
    return snapshot(limited);
  });
  await assert.rejects(browser.act('tab-1', { kind: 'type', text: '已送达' }, signal()),
    (error: unknown) => error instanceof CloudToolError && error.code === 'unknown');
  assert.equal(fake.commands.filter((command) => command.method === 'Input.insertText').length, 1);
  await assert.rejects(browser.act('tab-1', { kind: 'type', text: '未送达' }, signal()),
    (error: unknown) => error instanceof CloudToolError && error.code === 'not_configured');
});

test('等待客户端确认期间最后一次重绘不丢，确认后主动捕获当前画面', async (t) => {
  const fake = await fakeCdp();
  const browser = new CdpBrowser({ endpoint: fake.endpoint });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  const frames: BrowserFrame[] = [];
  const watch = await browser.watch({ width: 390, height: 700 }, (next) => frames.push(next), () => {}, signal());
  fake.frame(1);
  await until(() => frames.length === 1);
  await browser.act('tab-1', { kind: 'scroll', dy: 240 }, signal());
  fake.frame(2);
  fake.frame(3);
  await until(() => fake.commands.some((command) => command.method === 'Page.screencastFrameAck'
    && command.params['sessionId'] === 3));
  assert.equal(frames.length, 1);
  await watch.ack(frames[0]?.sequence ?? 0);
  await until(() => frames.length === 2);
  assert.equal((fake.commands.findLast((command) => command.method === 'Page.captureScreenshot')
    ?.params['clip'] as { y: number }).y, 240);
  await watch.ack(frames[0]?.sequence ?? 0);
  assert.equal(frames.length, 2);
  await watch.close();
});

test('点击后只查询远端活动元素是否可编辑，并把布尔状态交给客户端', async (t) => {
  const fake = await fakeCdp();
  const browser = new CloudBrowser({ transport: new CdpBrowser({ endpoint: fake.endpoint }), now: () => new Date() });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  await browser.userOpen('http://example.com/', signal());
  for (const editable of [false, true, false]) {
    fake.editable(editable);
    const view = await browser.userAct({ kind: 'click', x: 20, y: 30 }, signal(), 'tab-1');
    assert.equal(view.editableFocused, editable);
  }
  const queries = fake.commands.filter((command) => command.method === 'Runtime.evaluate');
  assert.equal(queries.length, 3);
  assert.ok(queries.every((command) => command.params['returnByValue'] === true));
});

test('排队点击执行时核对原标签，切页完成后拒绝旧标签的坐标', async (t) => {
  const fake = await fakeCdp();
  const browser = new CloudBrowser({ transport: new CdpBrowser({ endpoint: fake.endpoint }), now: () => new Date() });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  await browser.userOpen('http://example.com/', signal());
  fake.hold('Target.activateTarget');
  const switching = browser.tab({ kind: 'new' }, signal());
  await until(() => fake.commands.some((command) => command.method === 'Target.activateTarget'));
  const stale = assert.rejects(browser.userAct({ kind: 'click', x: 20, y: 30 }, signal(), 'tab-1'), /标签页已变化/);
  fake.release();
  await Promise.all([switching, stale]);
  assert.equal(fake.commands.some((command) => command.method === 'Input.dispatchMouseEvent'), false);
});

test('远端切页后仅松键可清理旧标签，已关闭标签的松键直接完成且不激活旧页', async (t) => {
  let snapshot: BrowserSnapshot = { activeTabId: 'tab-1', tabs: [
    { id: 'tab-1', title: '第一页', url: 'https://example.test/one' },
    { id: 'tab-2', title: '第二页', url: 'https://example.test/two' },
  ] };
  const sent: { tabId: string; action: BrowserAction }[] = [];
  const current = () => {
    const tab = snapshot.tabs.find((entry) => entry.id === snapshot.activeTabId);
    assert.ok(tab);
    return { sessionId: tab.id, url: tab.url, title: tab.title };
  };
  const transport: BrowserTransport = {
    open: async () => current(),
    act: async (tabId, action) => {
      sent.push({ tabId, action });
      return current();
    },
    snapshot: async () => snapshot,
    frame: async () => Buffer.from('fake frame'),
    text: async () => '',
  };
  const browser = new CloudBrowser({ transport, now: () => new Date() });
  t.after(() => browser.close());
  await browser.userAct({ kind: 'key', key: 'Control', code: 'ControlLeft', event: 'down' }, signal(), 'tab-1');
  snapshot = { ...snapshot, activeTabId: 'tab-2' };
  const up: BrowserAction = { kind: 'key', key: 'Control', code: 'ControlLeft', event: 'up', modifiers: 0 };
  const released = await browser.userAct(up, signal(), 'tab-1');
  assert.equal(released.activeTabId, 'tab-2');
  assert.deepEqual(sent.at(-1), { tabId: 'tab-1', action: up });
  await assert.rejects(browser.userAct({ kind: 'click', x: 20, y: 30 }, signal(), 'tab-1'), /标签页已变化/);
  await assert.rejects(browser.userAct({ kind: 'key', key: 'Enter', event: 'down' }, signal(), 'tab-1'), /标签页已变化/);
  await assert.rejects(browser.userAct({ kind: 'key', key: 'Enter' }, signal(), 'tab-1'), /标签页已变化/);
  snapshot = { ...snapshot, tabs: snapshot.tabs.filter((tab) => tab.id !== 'tab-1') };
  const closed = await browser.userAct(up, signal(), 'tab-1');
  assert.equal(closed.activeTabId, 'tab-2');
  assert.equal(sent.length, 2);
});

test('真实传输经回环 WebSocket 导航、前后退、刷新、输入中文、读页面和管理标签页', async (t) => {
  const fake = await fakeCdp();
  const transport = new CdpBrowser({ endpoint: fake.endpoint });
  t.after(async () => {
    transport.close();
    await fake.close();
  });
  const browser = new CloudBrowser({ transport, now: () => new Date() });
  const url = 'http://example.com/a?keyword=a%20b&keyword=C&token=discard';
  await browser.open(url, signal());
  assert.equal(fake.commands.find((c) => c.method === 'Page.navigate')?.params['url'],
    'http://example.com/a?keyword=a%20b&keyword=C');
  await assert.rejects(browser.open('file:///tmp/example', signal()));
  await browser.act({ kind: 'click', x: 100, y: 200 }, signal());
  await browser.act({ kind: 'move', x: 20, y: 30 }, signal());
  await browser.act({ kind: 'scroll', x: 20, y: 30, dx: 10, dy: 80 }, signal());
  await browser.act({ kind: 'type', text: '中文输入' }, signal());
  await browser.act({ kind: 'key', key: 'Enter', code: 'Enter', event: 'down', modifiers: 0 }, signal());
  await browser.act({ kind: 'key', key: 'F5', code: 'F5', event: 'down', modifiers: 0 }, signal());
  assert.equal(fake.commands.find((c) => c.method === 'Input.dispatchKeyEvent'
    && c.params['key'] === 'F5')?.params['windowsVirtualKeyCode'], 116);
  await browser.act({ kind: 'back' }, signal());
  await browser.act({ kind: 'forward' }, signal());
  await browser.act({ kind: 'reload' }, signal());
  assert.equal(await browser.text(signal()), '可读的页面');
  assert.equal(fake.commands.find((c) => c.method === 'Input.insertText')?.params['text'], '中文输入');
  assert.deepEqual(fake.commands.filter((c) => c.method === 'Page.navigateToHistoryEntry')
    .map((c) => c.params['entryId']), [1, 3]);
  await browser.tab({ kind: 'new' }, signal());
  assert.equal(browser.view().tabs?.length, 2);
  await browser.tab({ kind: 'switch', tabId: 'tab-1' }, signal());
  assert.equal(browser.view().activeTabId, 'tab-1');
  await browser.tab({ kind: 'close', tabId: 'tab-1' }, signal());
  assert.equal(browser.view().activeTabId, 'tab-2');
  await browser.tab({ kind: 'close', tabId: 'tab-2' }, signal());
  assert.equal(browser.view().tabs?.length, 1);
  assert.equal(browser.view().url, 'about:blank');
});

test('画面为 JPEG 70、采用客户端 CSS 视口；客户端确认前只推一帧，旧确认不能释放新帧', async (t) => {
  const fake = await fakeCdp();
  const browser = new CdpBrowser({ endpoint: fake.endpoint });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  await browser.open('https://example.com/', signal());
  const frames: BrowserFrame[] = [];
  const stream = await browser.watch({ width: 390, height: 844 }, (frame) => frames.push(frame), () => {}, signal());
  const start = fake.commands.find((c) => c.method === 'Page.startScreencast');
  assert.equal(start?.params['format'], 'jpeg');
  assert.equal(start?.params['quality'], 70);
  assert.equal(start?.params['maxWidth'], 390);
  fake.frame(1);
  fake.frame(2);
  await until(() => frames.length === 1);
  await pause(20);
  assert.equal(frames.length, 1);
  const first = frames[0];
  assert.ok(first);
  assert.equal(first.width, 390);
  await stream.ack(first.sequence);
  fake.frame(3);
  await until(() => frames.length === 2);
  await stream.ack(first.sequence);
  fake.frame(4);
  await pause(20);
  assert.equal(frames.length, 2);
  await stream.close();
  await until(() => fake.commands.some((c) => c.method === 'Page.stopScreencast'));
});

test('观看设置手机视口和 DPR，停止观看清除覆盖并恢复桌面内容区，不改 UA', async (t) => {
  const fake = await fakeCdp();
  const browser = new CdpBrowser({ endpoint: fake.endpoint });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  const frames: BrowserFrame[] = [];
  const watch = await browser.watch({ width: 390, height: 700, deviceScaleFactor: 3 },
    (frame) => frames.push(frame), () => {}, signal());
  assert.deepEqual(fake.commands.findLast((c) => c.method === 'Emulation.setDeviceMetricsOverride')?.params,
    { width: 390, height: 700, deviceScaleFactor: 2, mobile: true });
  const cast = fake.commands.findLast((c) => c.method === 'Page.startScreencast');
  assert.equal(cast?.params['maxWidth'], 780);
  assert.equal(cast?.params['maxHeight'], 1400);
  fake.frame(1);
  await until(() => frames.length === 1);
  assert.deepEqual(fake.commands.findLast((c) => c.method === 'Page.captureScreenshot')?.params, {
    format: 'jpeg', quality: 70, captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 390, height: 700, scale: 1 },
  });
  const before = fake.commands.length;
  await watch.close();
  assert.ok(fake.commands.slice(before).some((c) => c.method === 'Emulation.clearDeviceMetricsOverride'));
  assert.deepEqual(fake.commands.findLast((c) => c.method === 'Browser.setContentsSize')?.params,
    { windowId: 1, width: 1280, height: 800 });
  assert.ok(!fake.commands.some((c) => c.method.includes('UserAgent')));
});

test('桌面视口不按编码上限缩小 CSS 尺寸，编码长边最多 2000，切页后旧页恢复桌面', async (t) => {
  const fake = await fakeCdp();
  const browser = new CdpBrowser({ endpoint: fake.endpoint });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  const watch = await browser.watch({ width: 1440, height: 900, deviceScaleFactor: 2 },
    () => {}, () => {}, signal());
  assert.deepEqual(fake.commands.findLast((c) => c.method === 'Emulation.setDeviceMetricsOverride')?.params,
    { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  const cast = fake.commands.findLast((c) => c.method === 'Page.startScreencast');
  assert.equal(cast?.params['maxWidth'], 2000);
  assert.equal(cast?.params['maxHeight'], 1250);
  await browser.tab({ kind: 'new' }, signal());
  assert.ok(fake.commands.some((c) => c.method === 'Emulation.clearDeviceMetricsOverride'
    && c.sessionId === 'session-tab-1'));
  assert.equal(fake.commands.findLast((c) => c.method === 'Emulation.setDeviceMetricsOverride')?.sessionId,
    'session-tab-2');
  await watch.close();
});

test('页面自主导航同步真实地址和加载状态，停止操作发 Page.stopLoading', async (t) => {
  const fake = await fakeCdp();
  const transport = new CdpBrowser({ endpoint: fake.endpoint });
  const browser = new CloudBrowser({ transport, now: () => new Date() });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  const watch = await browser.watch({ width: 1000, height: 700 }, () => {}, () => {}, signal());
  fake.event('Page.frameStartedLoading', { frameId: 'frame-1' });
  await until(() => browser.view().loading === true);
  fake.event('Page.frameNavigated', { frame: { id: 'frame-1', url: 'https://example.com/next' } });
  await until(() => browser.view().url === 'https://example.com/next');
  await browser.userAct({ kind: 'stop' }, signal(), 'tab-1');
  assert.ok(fake.commands.some((c) => c.method === 'Page.stopLoading'));
  fake.event('Page.frameStoppedLoading', { frameId: 'frame-1' });
  await until(() => browser.view().loading === false);
  await watch.close();
});

test('滚动后截图取当前可见区域，不跳回文档顶部；取消观看不继续发送正在编码的帧', async (t) => {
  const fake = await fakeCdp();
  const browser = new CdpBrowser({ endpoint: fake.endpoint });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  const frames: BrowserFrame[] = [];
  const watch = await browser.watch({ width: 390, height: 700 }, (frame) => frames.push(frame), () => {}, signal());
  await browser.act('tab-1', { kind: 'scroll', dy: 240 }, signal());
  fake.frame(1);
  await until(() => frames.length === 1);
  const clip = fake.commands.findLast((c) => c.method === 'Page.captureScreenshot')?.params['clip'] as { y: number };
  assert.equal(clip.y, 240);
  await watch.ack(frames[0]?.sequence ?? 0);
  fake.hold('Page.captureScreenshot');
  fake.frame(2);
  await until(() => fake.commands.filter((c) => c.method === 'Page.captureScreenshot').length === 2);
  await watch.close();
  assert.equal(frames.length, 1);
});

test('导航命令未返回时用户仍能立即停止加载', async (t) => {
  const fake = await fakeCdp();
  const browser = new CloudBrowser({ transport: new CdpBrowser({ endpoint: fake.endpoint }), now: () => new Date() });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  const controller = new AbortController();
  fake.hold('Page.navigate');
  const navigation = browser.userOpen('https://example.com/', controller.signal);
  const cancelled = assert.rejects(navigation);
  await until(() => fake.commands.some((c) => c.method === 'Page.navigate'));
  const stop = browser.userAct({ kind: 'stop' }, signal(), 'tab-1');
  try {
    await until(() => fake.commands.some((c) => c.method === 'Page.stopLoading'));
  } finally {
    controller.abort();
    await cancelled;
    await stop;
  }
});

test('CDP 断线后待处理动作失败，下次读取重新连接；浏览器没起来有可重试文案', async (t) => {
  const fake = await fakeCdp();
  const browser = new CdpBrowser({ endpoint: fake.endpoint });
  t.after(() => browser.close());
  await browser.open('https://example.com/', signal());
  fake.hold('Input.insertText');
  const action = browser.act('tab-1', { kind: 'type', text: '输入' }, signal());
  const rejected = assert.rejects(action, /断开|重试/);
  await until(() => fake.commands.some((c) => c.method === 'Input.insertText'));
  fake.disconnect();
  await rejected;
  fake.hold(null);
  assert.equal((await browser.snapshot(signal())).tabs.length, 1);
  await fake.close();
  await until(() => !browser.connected);
  await assert.rejects(browser.snapshot(signal()), /浏览器还没起来/);
});

test('观看时关闭当前最后一页，先停旧录屏，再留空白页继续推新帧', async (t) => {
  const fake = await fakeCdp();
  const browser = new CdpBrowser({ endpoint: fake.endpoint });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  await browser.open('https://example.com/', signal());
  const frames: BrowserFrame[] = [];
  const watching = await browser.watch({ width: 1280, height: 800 }, (frame) => frames.push(frame), () => {}, signal());
  const state = await browser.tab({ kind: 'close', tabId: 'tab-1' }, signal());
  assert.equal(state.activeTabId, 'tab-2');
  assert.equal(state.tabs.length, 1);
  assert.ok(fake.commands.findIndex((c) => c.method === 'Page.stopScreencast')
    < fake.commands.findIndex((c) => c.method === 'Target.closeTarget'));
  fake.frame(5, 'tab-2');
  await until(() => frames.length > 0);
  assert.equal(frames[0]?.tabId, 'tab-2');
  await watching.close();
});

test('脑正在操作时用户接手会取消后续命令，脑的那一步报告用户接手了', async (t) => {
  const fake = await fakeCdp();
  const transport = new CdpBrowser({ endpoint: fake.endpoint });
  const browser = new CloudBrowser({ transport, now: () => new Date() });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  await browser.open('https://example.com/', signal());
  fake.hold('Input.insertText');
  const brain = browser.act({ kind: 'type', text: '脑的输入' }, signal());
  const taken = assert.rejects(brain, /用户接手了/);
  await until(() => fake.commands.some((c) => c.method === 'Input.insertText'));
  assert.equal(browser.view().controller, 'brain');
  await browser.userAct({ kind: 'move', x: 10, y: 20 }, signal(), 'tab-1');
  await taken;
  assert.equal(browser.view().controller, 'user');
});
