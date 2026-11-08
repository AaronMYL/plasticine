// 浏览器回归共用的底座：真服务端（agent/tests/app/helpers.ts 的 startTestApp：临时库、脚本模型、手拨的钟）、
// Vite 开发服务器（/v2 代理过去）、本机 Chromium（scripts/browser/cdp.ts）。新内核（线、按提供商的模型连接）按需装：
// 假提供商和 pi-ai 的假模型，不联网。等待、点击、填写都按读屏名字或可见文字找，和用户看到的一样。

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import type { FauxResponseStep, Message } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { launchBrowser, type Cdp, type LocalBrowser } from '../../scripts/browser/cdp.ts';
import type { ClientName } from '../../scripts/browser/client-profile.ts';
import { pair, startTestApp, type TestApp, type TestAppOptions } from '../../agent/tests/app/helpers.ts';
import type { TextStep } from '../../agent/tests/brain/helpers.ts';
import { fakeProviders, type FakeProviders } from '../../agent/tests/kernel/helpers.ts';
import { KernelModels, ProviderLogins } from '../../agent/src/kernel/index.ts';
import { checkedArgs, type KernelTool, type ModelSource } from '../../agent/src/lines/index.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WAIT_MS = 15_000;
export const SIZES = [[1440, 900], [768, 1024], [390, 844], [500, 500]] as const;

export interface Gates {
  /** 慢工具「慢慢做：<what>」放行，回 result。 */
  release(what: string, result?: string): void;
  /** 开始做过的 what，按先后。 */
  started: string[];
}

export interface Kernel {
  providers: FakeProviders;
  models: KernelModels;
  gates: Gates;
}

export interface StackOptions {
  /** 旧大脑的脚本步骤（不装新内核的场景用）。 */
  steps?: TextStep[];
  app?: TestAppOptions;
  /** 装新内核：线 + 按提供商的模型连接。connected：开场就登好假订阅（不走连接页）。 */
  kernel?: { connected: boolean };
  /** 页面开在哪（# 后面），默认首页。 */
  hash?: string;
  client?: ClientName;
  /** 服务端的钟拨到现在（按设备当月 / 当天显示的页面要）。 */
  realClock?: boolean;
  plugins?: Plugin[];
  /** 配对完成、首个页面打开之前准备场景，避免页面先登记旧钥匙或读取未准备的数据。 */
  beforeOpen?: (app: TestApp) => void | Promise<void>;
}

export interface Stack {
  app: TestApp;
  base: string;
  page: Cdp;
  browser: LocalBrowser;
  cookie: string;
  kernel: Kernel | null;
  /** 再开一页（同一个浏览器上下文，带登录）。 */
  open(hash: string, client?: ClientName): Promise<Cdp>;
}

function slowTool(started: string[], wait: (what: string) => Promise<string>): KernelTool {
  const parameters = Type.Object({ what: Type.String() }, { additionalProperties: false });
  return {
    name: 'slow',
    say: (args) => `慢慢做：${String(args['what'] ?? '')}`,
    hardLine: () => null,
    create: () => ({
      name: 'slow', label: '慢', description: '慢慢做', parameters,
      execute: async (_id, raw, signal) => {
        const { what } = checkedArgs(parameters, raw, 'slow');
        started.push(what);
        const aborted = new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('叫停了')), { once: true });
        });
        return { content: [{ type: 'text', text: await Promise.race([wait(what), aborted]) }], details: {} };
      },
    }),
  };
}

function gates(): { gates: Gates; wait: (what: string) => Promise<string> } {
  const open = new Map<string, { promise: Promise<string>; resolve: (value: string) => void }>();
  const entry = (what: string) => {
    let found = open.get(what);
    if (found === undefined) {
      let resolve: (value: string) => void = () => undefined;
      const promise = new Promise<string>((done) => {
        resolve = done;
      });
      found = { promise, resolve };
      open.set(what, found);
    }
    return found;
  };
  const started: string[] = [];
  return {
    gates: { started, release: (what, result = `${what}：查完了`) => entry(what).resolve(result) },
    wait: (what) => entry(what).promise,
  };
}

function textOf(message: Message): string {
  if (message.role === 'assistant') {
    return message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('');
  }
  const content = message.content;
  return typeof content === 'string' ? content
    : content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('');
}

/**
 * 假模型按对话决定下一步（几条线共用一个假提供商，谁先来取不一定）：
 * 最后一条是工具结果 → 收尾说一句；用户说「后台」→ 开一条后台线；说「查」→ 用慢工具（等测试放行）；
 * 其他 → 「收到：<原话>」。
 */
const brain: FauxResponseStep = (context) => {
  const last = context.messages.at(-1);
  if (last === undefined) {
    return fauxAssistantMessage('收到。');
  }
  const said = textOf(last);
  if (last.role === 'toolResult') {
    return fauxAssistantMessage(said.includes('started') ? '开了一条后台线去查，查完贴回来。' : `做完了：${said}`);
  }
  if (said.includes('后台')) {
    return fauxAssistantMessage([fauxToolCall('start_line', { title: '查 CuaDriver 的安装来源',
      goal: '慢慢查 CuaDriver 的安装来源' })], { stopReason: 'toolUse' });
  }
  if (said.includes('查')) {
    const what = said.includes('安装来源') ? '安装来源' : said.replace(/\s+/g, '').slice(0, 12);
    return fauxAssistantMessage([fauxToolCall('slow', { what })], { stopReason: 'toolUse' });
  }
  return fauxAssistantMessage([fauxText(`收到：${said}`)]);
};

function kernelOptions(connected: boolean): { kernel: () => Kernel; options: TestAppOptions } {
  const providers = fakeProviders();
  const responses = Array.from({ length: 200 }, () => brain);
  providers.oauth.setResponses(responses);
  providers.keyOnly.setResponses(responses);
  const control = gates();
  let models: KernelModels | undefined;
  const need = (): KernelModels => {
    assert.ok(models !== undefined, '模型连接先装好');
    return models;
  };
  // 线比模型连接晚装：转一手，到用时 models 已经在了。
  const source: ModelSource = {
    current: () => need().current(),
    streamFn: (model, context, options) => need().streamFn(model, context, options),
    complete: (model, context, signal) => need().complete(model, context, signal),
  };
  return {
    kernel: () => ({ providers, models: need(), gates: control.gates }),
    options: {
      lines: { models: source, tools: () => [slowTool(control.gates.started, control.wait)] },
      kernelModels: (state) => {
        models = new KernelModels({ state, providers: providers.providers });
        if (connected) {
          state.kernelCredentials.write('fake-sub', 'oauth', { type: 'oauth', access: 'access-value-for-tests',
            refresh: 'refresh-value-for-tests', expires: Date.now() + 3_600_000 });
        }
        return { models, logins: new ProviderLogins(models) };
      },
    },
  };
}

export async function startStack(t: TestContext, options: StackOptions = {}): Promise<Stack> {
  const kernel = options.kernel === undefined ? null : kernelOptions(options.kernel.connected);
  const app = await startTestApp(options.steps ?? [], { startTasks: false, ...options.app,
    ...(kernel === null ? {} : kernel.options) });
  let vite: ViteDevServer | undefined;
  let browser: LocalBrowser | undefined;
  // 先关浏览器和 Vite，再关服务端：反过来实时连接会在代理上报一串连接被重置。
  t.after(async () => {
    await browser?.close();
    await vite?.close();
    await app.close();
  });
  if (options.realClock === true) {
    app.clock.advance(Date.now() - app.clock.now().getTime());
  }
  vite = await createServer({ root: CLIENT_ROOT, logLevel: 'error', plugins: options.plugins ?? [],
    // 浏览器回归和截图可同时跑：每个临时应用独立预构建，避免彼此重写依赖缓存触发刷新或两份 React。
    cacheDir: join(app.directory, 'vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/v2': { target: app.base } } } });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address !== null && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  browser = await launchBrowser();
  const cookie = await pair(app);
  await options.beforeOpen?.(app);
  const [name, value] = cookie.split('=');
  const opened = browser;
  const open = async (hash: string, client: ClientName = options.client ?? 'mac'): Promise<Cdp> => {
    const page = await opened.page(`${base}/browser-tests/fixtures/app.html#${hash}`, client);
    await page.send('Network.setCookie', { name, value, url: base });
    if (client === 'mac' || client === 'web') {
      await size(page, 1440, 900);
    }
    await page.send('Page.reload');
    return page;
  };
  const page = await open(options.hash ?? '/today');
  return { app, base, page, browser, cookie, kernel: kernel?.kernel() ?? null, open };
}

export async function size(page: Cdp, width: number, height: number): Promise<void> {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}

export async function until(page: Cdp, expression: string, label: string, ms = WAIT_MS): Promise<void> {
  const deadline = Date.now() + ms;
  while (!await page.evaluate<boolean>(`Boolean(${expression})`)) {
    if (Date.now() > deadline) {
      const seen = await page.evaluate<string>(`location.hash + ' ' + (document.body?.innerText ?? '').slice(0, 600)`)
        .catch(() => '读不到页面');
      throw new Error(`浏览器等不到：${label}（页面：${JSON.stringify(seen)}）`);
    }
    await pause(30);
  }
}

/** 测试进程里的条件（服务端的库、模型收到的请求）。 */
export async function settle(done: () => boolean | Promise<boolean>, label: string, ms = WAIT_MS): Promise<void> {
  const deadline = Date.now() + ms;
  while (!await done()) {
    if (Date.now() > deadline) {
      throw new Error(`等不到：${label}`);
    }
    await pause(30);
  }
}

/** scope 是选择器（'.line-scroll'）或一段取元素的表达式（以 document 或括号开头）。 */
export function text(expected: string, scope = 'document.body'): string {
  const target = /^(document|\()/.test(scope) ? scope : `document.querySelector(${JSON.stringify(scope)})`;
  return `(${target})?.textContent.includes(${JSON.stringify(expected)})`;
}

/** 按读屏名字或可见文字找按钮（scope 里、能点的）。 */
export function button(label: string, scope = 'document'): string {
  return `Array.from((${scope})?.querySelectorAll('button, [role="menuitem"]') ?? []).find(node => !node.disabled
    && node.getClientRects().length > 0
    && ((node.getAttribute('aria-label') ?? '') === ${JSON.stringify(label)}
      || node.textContent.trim() === ${JSON.stringify(label)}))`;
}

/** 找到就点（同一次脚本里），免得找到之后重画换掉了按钮。 */
export async function click(page: Cdp, label: string, scope = 'document'): Promise<void> {
  await until(page, `(() => { const found = ${button(label, scope)}; found?.click(); return found !== undefined; })()`,
    `按钮「${label}」`);
}

export async function fill(page: Cdp, selector: string, value: string): Promise<void> {
  await until(page, `document.querySelector(${JSON.stringify(selector)})`, selector);
  await page.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

export async function key(page: Cdp, name: 'Enter' | 'Tab' | 'Escape'): Promise<void> {
  const codes = { Enter: 13, Tab: 9, Escape: 27 } as const;
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name,
    windowsVirtualKeyCode: codes[name], ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name,
    windowsVirtualKeyCode: codes[name] });
}

/** 设了 PLASTICINE_BROWSER_EVIDENCE 才存截图。 */
export async function capture(page: Cdp, name: string): Promise<void> {
  const directory = process.env['PLASTICINE_BROWSER_EVIDENCE'];
  if (directory === undefined) {
    return;
  }
  await mkdir(directory, { recursive: true });
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, `${name}.png`), Buffer.from(String(shot['data']), 'base64'));
}

/**
 * 几种宽度 × 明暗下：页面不横向溢出，target 和它里面的按钮、输入框都在窗口里。phone=false 的页面手机上没有
 * （手机只有首页、消息、笔记、信息流），只量 768 以上。量完回到 1440 浅色。
 */
export async function layouts(page: Cdp, prefix: string, target: string, phone = true): Promise<void> {
  for (const [width, height] of SIZES.filter(([width]) => phone || width >= 768)) {
    for (const theme of ['light', 'dark']) {
      await size(page, width, height);
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      // 换宽度时侧栏、对话框有收起动效，等它落定再量。
      await pause(300);
      await until(page, `document.querySelector(${JSON.stringify(target)})?.getBoundingClientRect().width > 0`,
        `${prefix} ${width} 可见`);
      await page.evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({ block: 'start' })`);
      await pause(80);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false,
        `${prefix} ${width} ${theme} 不横向溢出`);
      assert.deepEqual(await page.evaluate(`(() => {
        const area = document.querySelector(${JSON.stringify(target)});
        // 横向滑动的一行（手机上设置的分类）里滑出窗口的那几个不算：滑过去就看得见、点得到。
        const scrolled = (node) => {
          for (let up = node.parentElement; up !== null && up !== area.parentElement; up = up.parentElement) {
            const overflow = getComputedStyle(up).overflowX;
            if ((overflow === 'auto' || overflow === 'scroll') && up.scrollWidth > up.clientWidth + 1) return true;
          }
          return false;
        };
        return Array.from(area.querySelectorAll('button, input, select, textarea')).filter(node => {
          if (scrolled(node)) return false;
          const box = node.getBoundingClientRect();
          return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1);
        }).map(node => node.getAttribute('aria-label') || node.textContent.trim().slice(0, 30));
      })()`), [], `${prefix} ${width} ${theme} 操作完整`);
      await capture(page, `${prefix}-${width}-${theme}`);
    }
  }
  await size(page, 1440, 900);
  await page.evaluate(`document.documentElement.dataset.theme = 'light'`);
  await pause(200);
}
