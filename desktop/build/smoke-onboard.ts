// 首次使用流程的冒烟（11-08，xvfb，smoke.ts 跑完接着跑）：
// A. 真本体（仓库里的 agent/src/app/main.ts，状态目录是临时目录）：第一次打开停在二选一（亮 / 暗 / Windows 外观各截
//    一张）→「连到我的 Plasticine」写错账号、到不了的地址都就地一行原因 →「在这台电脑上」→ 正在打开 → 载入本机本体。
// B. 假本体（tests/fixtures/fake-local-body.ts，模拟还没合进来的账号接口，账号状态 done）：选这台电脑 → 壳带本机令牌
//    替界面登录、Cookie 写进界面 → 界面直接是登录着的，localGrant 拿到的令牌和本体手里的对得上 → 「换一个地方」回
//    开始页并标出现在用的那个 → 再选回来 → 在界面里等一次登录回调（external.capture）。
// Windows 外观那张：Linux 上没有 titleBarOverlay，右上角的三个窗口按钮是截图时画上去的示意，只看内容让没让出来。

import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { Cdp } from '../../scripts/browser/cdp.ts';
import { bundle } from './bundle.ts';
import { DESKTOP, ELECTRON, freePort, PACKAGED, ROOT, shootPage, stop, targets, until } from './smoke-kit.ts';

const LOCAL = 'http://127.0.0.1:8790/';

const WINDOWS_CONTROLS = `(() => {
  const glyphs = ['<path d="M3 8h10"/>', '<rect x="3.5" y="3.5" width="9" height="9"/>',
    '<path d="m3.5 3.5 9 9M12.5 3.5l-9 9"/>'];
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:0;right:0;display:flex;color:var(--fg2);z-index:9';
  bar.innerHTML = glyphs.map((g) => '<span style="width:46px;height:32px;display:flex;align-items:center;'
    + 'justify-content:center"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"'
    + ' stroke-width="1.6">' + g + '</svg></span>').join('');
  document.body.appendChild(bar);
  document.documentElement.dataset.platform = 'windows';
  document.getElementById('stops-when').textContent = '关机就停';
})()`;

function serverDir(work: string, name: string, entry: string | null): string {
  const dir = join(work, name);
  mkdirSync(join(dir, 'agent', 'src', 'app'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), '{}\n');
  if (entry === null) {
    rmSync(join(dir, 'agent'), { recursive: true, force: true });
    symlinkSync(join(ROOT, 'agent'), join(dir, 'agent'));
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    symlinkSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  } else {
    copyFileSync(entry, join(dir, 'agent', 'src', 'app', 'main.ts'));
  }
  return dir;
}

async function buildClient(into: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(join(ROOT, 'node_modules', '.bin', 'vite'), ['build', '--outDir', into, '--emptyOutDir',
      '--logLevel', 'error'], { cwd: join(ROOT, 'client'), stdio: 'inherit' });
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`界面没打好（${code}）`))));
  });
}

interface Shell {
  electron: ChildProcess;
  ui: Cdp;
}

async function open(home: string, server: string): Promise<Shell> {
  const debugPort = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PLASTICINE_DESKTOP_SERVER: server,
    PLASTICINE_DESKTOP_NODE: process.execPath, NODE_OPTIONS: '' };
  delete env.PLASTICINE_DESKTOP_URL;
  const electron = spawn(PACKAGED ?? ELECTRON, [...(PACKAGED === null ? ['.'] : []), '--no-sandbox',
    `--remote-debugging-port=${debugPort}`], { cwd: DESKTOP, stdio: ['ignore', 'ignore', 'inherit'], env });
  const target = await until('壳打开开始页', async () => (await targets(debugPort))
    .find((candidate) => candidate.type === 'page' && candidate.url.includes('start.html')));
  return { electron, ui: await Cdp.connect(target.webSocketDebuggerUrl) };
}

async function close(shell: Shell): Promise<void> {
  shell.ui.close();
  const exited = new Promise((resolve) => shell.electron.once('exit', resolve));
  stop(shell.electron);
  await exited;
  await until('本机本体停下、8790 空出来', async () => {
    try {
      await fetch(`${LOCAL}v2/health`, { signal: AbortSignal.timeout(500) });
      return false;
    } catch (error) {
      return error instanceof Error;
    }
  });
}

const visible = (ui: Cdp, id: string): Promise<boolean> => ui.evaluate<boolean>(
  `document.getElementById(${JSON.stringify(id)})?.hidden === false && document.fonts.status === 'loaded'`);

async function type(ui: Cdp, text: string): Promise<void> {
  await ui.evaluate<void>("(() => { const a = document.getElementById('address'); a.focus(); a.select(); })()");
  await ui.send('Input.insertText', { text });
}

async function realBody(work: string, shots: string, passed: string[]): Promise<void> {
  const server = serverDir(work, 'real-server', null);
  await buildClient(join(server, 'client', 'dist'));
  const shell = await open(join(work, 'home-a'), server);
  const { ui } = shell;
  try {
    await until('第一次打开停在二选一', () => visible(ui, 'welcome'));
    const chosen = await ui.evaluate<string>("document.querySelector('.card.on')?.id ?? 'none'");
    if (chosen !== 'none' || (await fetch(`${LOCAL}v2/health`).then(() => true, () => false))) {
      throw new Error('第一次打开就替他选了，或本机本体已经在跑');
    }
    passed.push('第一次打开：二选一，没有默认选择，本机本体没起');
    await pause(300);
    await shootPage(ui, shots, 'onboard-1-welcome-light');
    await ui.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await pause(300);
    await shootPage(ui, shots, 'onboard-2-welcome-dark');
    await ui.send('Emulation.setEmulatedMedia', { features: [] });
    await ui.evaluate<void>(WINDOWS_CONTROLS);
    await pause(300);
    await shootPage(ui, shots, 'onboard-3-welcome-windows');
    await ui.send('Page.reload');
    await until('重新载入开始页（去掉示意的窗口按钮）', async () => await visible(ui, 'welcome')
      && await ui.evaluate<boolean>("document.documentElement.dataset.platform === 'linux'"));
    await ui.evaluate<void>("document.getElementById('choose-remote').click()");
    await until('第二步：@账号或地址', () => visible(ui, 'remote'));
    await type(ui, '@sample-user');
    const host = await ui.evaluate<string>("document.getElementById('address-host').textContent");
    if (host !== 'sample-user.cyberhunter.top') {
      throw new Error(`@账号没换成网址：${host}`);
    }
    await pause(200);
    await shootPage(ui, shots, 'onboard-4-remote-handle');
    await ui.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await pause(300);
    await shootPage(ui, shots, 'onboard-4-remote-handle-dark');
    await ui.send('Emulation.setEmulatedMedia', { features: [] });
    await type(ui, '@a b');
    await ui.evaluate<void>("document.getElementById('connect').click()");
    await until('写错的账号就地报原因', () => visible(ui, 'address-error'));
    await type(ui, '127.0.0.1:9');
    await ui.evaluate<void>("document.getElementById('connect').click()");
    const unreachable = await until('到不了的地址就地报原因', () => ui.evaluate<string | null>(
      "(() => { const e = document.getElementById('address-error'); return !e.hidden && /连不上/.test(e.textContent)"
      + ' ? e.textContent : null; })()'));
    await pause(200);
    await shootPage(ui, shots, 'onboard-5-remote-unreachable');
    passed.push(`连到我的 Plasticine：@账号预览成网址，写错就地报原因，到不了的地址：${unreachable}`);
    await ui.evaluate<void>("document.querySelector('#remote [data-back]').click()");
    await until('换一个地方回到二选一', () => visible(ui, 'welcome'));
    await ui.evaluate<void>("document.getElementById('choose-local').click()");
    await until('开始页显示正在打开', () => visible(ui, 'starting'));
    await shootPage(ui, shots, 'onboard-6-starting');
    await until('载入本机本体（真本体，账号接口还没合进来时照旧载入首页）', () => ui.evaluate<boolean>(
      `location.href.startsWith(${JSON.stringify(LOCAL)}) && document.body.innerText.length > 10`));
    await pause(1_500);
    await shootPage(ui, shots, 'onboard-7-real-body');
    passed.push('在这台电脑上：开始页显示正在打开，仓库里的本体（临时状态目录）起来后载入 127.0.0.1:8790');
  } finally {
    await close(shell);
  }
}

async function fakeBody(work: string, shots: string, passed: string[]): Promise<void> {
  const server = serverDir(work, 'fake-server', join(DESKTOP, 'tests', 'fixtures', 'fake-local-body.ts'));
  const shell = await open(join(work, 'home-b'), server);
  const { ui } = shell;
  try {
    await until('第一次打开停在二选一', () => visible(ui, 'welcome'));
    await ui.evaluate<void>("document.getElementById('choose-local').click()");
    await until('开始页显示正在打开', () => visible(ui, 'starting'));
    const signedIn = (): Promise<boolean> => ui.evaluate<boolean>(`location.href === ${JSON.stringify(LOCAL)}
      && document.getElementById('session')?.textContent === '已登录'
      && document.getElementById('grant')?.textContent === '界面拿到的本机令牌对得上'`);
    await until('界面直接登录着、localGrant 对得上', signedIn);
    await shootPage(ui, shots, 'onboard-8-auto-signed-in');
    passed.push('账号状态 done：壳带本机令牌替界面登录，Cookie 写进界面，没见登录页；localGrant 给的令牌对得上');
    await ui.evaluate<void>('window.plasticineDesktop.server.showWelcome()');
    await until('换一个地方：回开始页，标出这台电脑', async () => await visible(ui, 'welcome')
      && await ui.evaluate<string>("document.querySelector('.card.on')?.id ?? ''") === 'choose-local');
    await pause(300);
    await shootPage(ui, shots, 'onboard-9-welcome-current');
    await ui.evaluate<void>("document.getElementById('choose-local').click()");
    await until('再选回来，仍然登录着', signedIn);
    const port = await freePort();
    await ui.evaluate<void>(`void (window.__captured = window.plasticineDesktop.external.capture(${port}, 20000))`);
    await pause(500);
    const page = await (await fetch(`http://127.0.0.1:${port}/auth/callback?code=fake-code`)).text();
    const captured = await ui.evaluate<string | null>('window.__captured');
    if (captured !== `http://localhost:${port}/auth/callback?code=fake-code` || !page.includes('回到 Plasticine')) {
      throw new Error(`登录回调没接到：${captured}`);
    }
    passed.push('external.capture：浏览器跳回本机端口，界面拿到完整回调地址，浏览器看到「已完成」');
  } finally {
    await close(shell);
  }
}

export async function smokeOnboard(shots: string): Promise<string[]> {
  mkdirSync(shots, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'plasticine-desktop-onboard-'));
  const passed: string[] = [];
  try {
    await realBody(work, shots, passed);
    await fakeBody(work, shots, passed);
    return passed;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const shots = process.argv[2] ?? join(tmpdir(), 'plasticine-desktop-shots');
  try {
    if (PACKAGED === null) {
      await bundle();
    }
    const passed = await smokeOnboard(shots);
    console.log(['冒烟通过：', ...passed.map((line) => `  ✔ ${line}`), `截图：${shots}`].join('\n'));
    process.exit(0);
  } catch (error) {
    console.error(`冒烟没过：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
