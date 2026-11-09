// Linux 上的 Electron 冒烟（xvfb）：打好壳 → 起假接口的界面（client 的 Vite）和一个英文网页 → 用壳打开界面 →
// 从界面里开一个网页标签（走真实的「站外链接开成网页标签」那条路）→ 注入的翻译脚本报 page → 开翻译，界面拿假接口
// 译好送回 → 网页标签里出现译文 → 带尺寸的 window.open 开成登录小窗口（同一个 session、经 opener 交回消息、自己
// 关掉）→ 浮层压着时点击转给网页标签（跨站 iframe 里也点得到）。每一步截一张整屏图（import -window root）。
// 之后跑首次使用流程（smoke-onboard.ts）：
// 开始页二选一、连远程的就地报错、本机本体起来、本机自动登录。真实的 Mac / Windows 行为这里验不了。
//   xvfb-run -a -s "-screen 0 1440x900x24" node desktop/build/smoke.ts [截图目录]

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { Cdp } from '../../scripts/browser/cdp.ts';
import { bundle } from './bundle.ts';
import { smokeOnboard } from './smoke-onboard.ts';
import { DESKTOP, ELECTRON, freePort, PACKAGED, ROOT, shoot, stop, targets, until } from './smoke-kit.ts';

const ARTICLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Vertical tabs</title>
<link rel="icon" href="/favicon.png"></head><body style="font:18px/1.6 sans-serif;max-width:720px;margin:40px auto">
<h1>Why vertical tabs</h1>
<p>Tab bars used to be horizontal, back when people only had five or six pages open at a time.</p>
<p>Once the tab count grows to twenty or thirty, a horizontal strip is just a row of tiny icons
nobody can tell apart.</p>
<p>Putting tabs on the side shows full titles, lets groups collapse, and keeps pinned sites as a row of icons.</p>
<iframe id="cross" title="cross" style="position:absolute;left:40px;top:420px;width:320px;height:80px;border:0">
</iframe>
<script>window.__clicks = 0; addEventListener('mousedown', () => { window.__clicks += 1; });
// 跨站 iframe（localhost 对 127.0.0.1）：转过去的点要能点到里面（「用 Google 登录」按钮就是这样的 iframe）。
window.__inner = 0; addEventListener('message', (event) => { if (event.data === 'inner-down') window.__inner += 1; });
document.getElementById('cross').src = 'http://localhost:' + location.port + '/inner';</script>
</body></html>`;
const INNER = `<!doctype html><body style="margin:0;background:#e8f0ff;font:14px sans-serif">cross-site frame
<script>addEventListener('mousedown', () => parent.postMessage('inner-down', '*'));</script></body>`;
/** 登录弹窗那样的小窗口：打开就把自己看到的 Cookie 交回 opener，收到 close 就自己关掉。 */
const POPUP = `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head>
<body style="font:16px sans-serif;margin:24px"><h2>Sign in</h2><script>
addEventListener('message', (event) => { if (event.data === 'close') window.close(); });
window.opener.postMessage({ from: 'popup', cookie: document.cookie }, '*');
</script></body></html>`;

async function site(): Promise<{ server: Server; url: string }> {
  const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQ'
    + 'AAAABJRU5ErkJggg==', 'base64');
  const server = createServer((req, res) => {
    if (req.url === '/favicon.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(icon);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url === '/popup' ? POPUP : req.url === '/inner' ? INNER : ARTICLE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/article` };
}

/**
 * 带尺寸的 window.open 开成真的小窗口：同一个 session（Cookie 一样）、opener 在（postMessage 交得回去）、页面自己
 * window.close() 就关掉；不开成网页标签。
 */
async function popupWindow(debugPort: number, articleUrl: string, ui: Cdp, shots: string): Promise<string> {
  const popupUrl = new URL('/popup', articleUrl).href;
  const article = await until('拿到网页标签的调试连接', async () => (await targets(debugPort))
    .find((target) => target.url === articleUrl));
  const tab = await Cdp.connect(article.webSocketDebuggerUrl);
  try {
    await tab.evaluate<void>(`(() => { document.cookie = 'smoke=popup'; window.__popup = [];
      addEventListener('message', (event) => window.__popup.push(event.data));
      window.__popupWindow = window.open(${JSON.stringify(popupUrl)}, 'login', 'width=480,height=520'); })()`);
    const message = await until('小窗口经 opener 交回消息', () => tab.evaluate<{ cookie: string } | null>(
      "window.__popup.find((m) => m && m.from === 'popup') ?? null"));
    if (!message.cookie.includes('smoke=popup')) {
      throw new Error(`小窗口和网页标签不在同一个 session：${message.cookie}`);
    }
    await pause(800);
    await shoot(shots, '3-登录小窗口');
    await tab.evaluate<void>("window.__popupWindow.postMessage('close', '*')");
    await until('小窗口自己关掉', async () => !(await targets(debugPort)).some((target) => target.url === popupUrl));
    const asTab = await ui.evaluate<boolean>(`window.__smoke.tab.some((e) => e.type === 'opened'
      && e.url === ${JSON.stringify(popupUrl)})`);
    if (asTab) {
      throw new Error('带尺寸的 window.open 被开成了网页标签');
    }
    return '带尺寸的 window.open 开成小窗口：同一个 session，经 opener 交回消息，页面 window.close() 就关掉';
  } finally {
    tab.close();
  }
}

export async function smoke(shots: string): Promise<string[]> {
  mkdirSync(shots, { recursive: true });
  if (PACKAGED === null) {
    await bundle();
  }
  const passed: string[] = [];
  const home = mkdtempSync(join(tmpdir(), 'plasticine-desktop-smoke-'));
  const page = await site();
  const vitePort = await freePort();
  const debugPort = await freePort();
  let vite: ChildProcess | null = null;
  let electron: ChildProcess | null = null;
  try {
    vite = spawn(join(ROOT, 'node_modules', '.bin', 'vite'), ['--host', '127.0.0.1', '--port', String(vitePort),
      '--strictPort'], { cwd: join(ROOT, 'client'), stdio: 'ignore' });
    const uiUrl = `http://127.0.0.1:${vitePort}/`;
    await until('假接口的界面起来', async () => (await fetch(uiUrl)).ok);
    const app = PACKAGED === null ? ['.'] : [];
    electron = spawn(PACKAGED ?? ELECTRON, [...app, '--no-sandbox', `--remote-debugging-port=${debugPort}`],
      { cwd: DESKTOP,
      stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, HOME: home, PLASTICINE_DESKTOP_URL: uiUrl,
        NODE_OPTIONS: '' } });
    const uiTarget = await until('壳打开界面', async () => (await targets(debugPort))
      .find((target) => target.url.startsWith(uiUrl)));
    const ui = await Cdp.connect(uiTarget.webSocketDebuggerUrl);
    await until('界面拿到壳的接口', () => ui.evaluate<boolean>(
      "typeof window.plasticineDesktop === 'object' && typeof window.plasticineMac === 'undefined'"
      + " && window.plasticineDesktop.platform === 'linux'"));
    passed.push('主窗口载入假接口的界面，preload 只暴露 plasticineDesktop（不再挂旧名字 plasticineMac）');
    await until('界面画出来', () => ui.evaluate<boolean>("document.querySelector('#root, main') !== null"
      + ' && document.body.innerText.length > 20'));
    await pause(1_500);
    await shoot(shots, '1-界面');
    await ui.evaluate<void>(`(() => { window.__smoke = { tab: [], translate: [] };
      const tab = window.__plasticineWebTabEvent; window.__plasticineWebTabEvent = (e) => {
        window.__smoke.tab.push(e); return tab?.(e); };
      const tr = window.__plasticineTranslateEvent; window.__plasticineTranslateEvent = (e) => {
        window.__smoke.translate.push(e); return tr?.(e); };
      window.open(${JSON.stringify(page.url)}); })()`);
    const tabId = await until('网页标签开出来（opened）', () => ui.evaluate<string | null>(
      "window.__smoke.tab.find((e) => e.type === 'opened')?.tabId ?? null"));
    await until('网页标签载入那一页', async () => (await targets(debugPort)).find((target) => target.url === page.url));
    passed.push(`站外链接开成网页标签（${tabId}），WebContentsView 载入了网页`);
    await until('网页标签报 state', () => ui.evaluate<boolean>(
      `window.__smoke.tab.some((e) => e.type === 'state' && e.tabId === ${JSON.stringify(tabId)} && !e.loading)`));
    await until('网站图标（icon 事件）', () => ui.evaluate<boolean>(
      "window.__smoke.tab.some((e) => e.type === 'icon' && e.icon.startsWith('data:image/png'))"));
    passed.push('网页标签报地址标题（state）和网站图标（icon，data:image/png）');
    await until('注入的翻译脚本报 page', () => ui.evaluate<boolean>(
      `window.__smoke.translate.some((e) => e.type === 'page' && e.tabId === ${JSON.stringify(tabId)})`));
    passed.push('翻译脚本注入到网页标签（独立脚本世界），报了 page');
    await ui.evaluate<void>(`window.plasticineDesktop.translate.configure(${JSON.stringify(tabId)},
      { run: 'smoke1', target: 'zh-CN', display: 'bilingual' })`);
    await until('翻译脚本要段落（request）', () => ui.evaluate<boolean>(
      "window.__smoke.translate.some((e) => e.type === 'request' && e.items.length > 0)"));
    const article = await until('拿到网页标签的调试连接', async () => (await targets(debugPort))
      .find((target) => target.url === page.url));
    const tab = await Cdp.connect(article.webSocketDebuggerUrl);
    const translatedNow = (): Promise<boolean> => tab.evaluate<boolean>(
      "document.body.innerText.includes('〔译〕')");
    await pause(5_000);
    const translated = await translatedNow();
    if (process.env.SMOKE_DEBUG === '1') {
      console.log(JSON.stringify(await ui.evaluate<unknown>('window.__smoke.translate'), null, 1).slice(0, 3000));
      console.log(await tab.evaluate<string>('document.body.innerHTML.slice(0, 2000)'));
    }
    if (!translated) {
      await ui.evaluate<void>(`(() => { const r = window.__smoke.translate.find((e) => e.type === 'request');
        window.plasticineDesktop.translate.deliver(r.tabId, { run: r.run,
          items: r.items.map((i) => ({ id: i.id, text: '〔译〕' + i.text })), failed: [] }); })()`);
      await until('网页里出现译文', translatedNow);
    }
    // 这一轮是冒烟直接经接口开的，界面不认它的 run，不会自己去译：由冒烟照界面的做法 deliver 回去。
    passed.push(`翻译脚本切段要译文（request），译文送回后插进网页标签${translated ? '（界面自己译好送回）'
      : '（冒烟经 translate.deliver 送回）'}`);
    tab.close();
    const snapshot = await ui.evaluate<{ text: string; tabId: string }>(
      `window.plasticineDesktop.webTabs.snapshot(${JSON.stringify(tabId)})`);
    if (!snapshot.text.includes('vertical tabs') && !snapshot.text.includes('Tab bars')) {
      throw new Error('问这一页的正文不对');
    }
    passed.push('问这一页（snapshot）读到网页正文');
    passed.push(await popupWindow(debugPort, page.url, ui, shots));
    // 浮层压在网页标签上：标签垫到界面下面，浮层外的点由界面 preload 转给标签，浮层里的点留给界面。
    await ui.evaluate<void>(`window.plasticineDesktop.webTabs.sync({ tabs: [{ tabId: ${JSON.stringify(tabId)},
      url: ${JSON.stringify(page.url)} }], active: ${JSON.stringify(tabId)},
      frame: { x: 300, y: 100, width: 900, height: 700 },
      hitRegions: [{ x: 900, y: 500, width: 250, height: 250 }] })`);
    await pause(500);
    // 和人点一样：先移过去再按下抬起（跨站 iframe 靠移过去时的命中测试认出点的是它）。
    const press = async (x: number, y: number): Promise<void> => {
      await ui.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await pause(100);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await ui.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
      await pause(300);
    };
    const clicks = (): Promise<number> => tab2.evaluate<number>('window.__clicks');
    const tab2 = await Cdp.connect(article.webSocketDebuggerUrl);
    const before = await clicks();
    await press(500, 300);
    const forwarded = await clicks();
    await press(1000, 600);
    const kept = await clicks();
    // 视图在 (300, 100)，iframe 在页面里 (40, 420) 起 320 × 80：点它中间。
    await press(300 + 40 + 160, 100 + 420 + 40);
    const inner = await tab2.evaluate<number>('window.__inner');
    tab2.close();
    if (forwarded !== before + 1 || kept !== forwarded) {
      throw new Error(`浮层外 / 里的点没分对：${before} → ${forwarded} → ${kept}`);
    }
    if (inner !== 1) {
      throw new Error(`转过去的点没点到跨站 iframe 里（${inner}）`);
    }
    passed.push('浮层压在网页标签上时，浮层外的点转给网页标签（跨站 iframe 里也点得到），浮层里的点留给界面');
    await pause(1_000);
    await shoot(shots, '2-网页标签与译文');
    ui.close();
    return passed;
  } finally {
    stop(electron);
    stop(vite);
    page.server.close();
    await pause(1_000);
    rmSync(home, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const shots = process.argv[2] ?? join(tmpdir(), 'plasticine-desktop-shots');
  try {
    const passed = [...await smoke(shots), ...await smokeOnboard(shots)];
    console.log(['冒烟通过：', ...passed.map((line) => `  ✔ ${line}`), `截图：${shots}`].join('\n'));
    process.exit(0);
  } catch (error) {
    console.error(`冒烟没过：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
