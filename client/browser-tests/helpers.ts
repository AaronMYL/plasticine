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
import type { TextStep } from '../../agent/tests/tools/helpers.ts';
import { fakeProviders, type FakeProviders } from '../../agent/tests/kernel/helpers.ts';
import { KernelModels, ProviderLogins } from '../../agent/src/kernel/index.ts';
import { checkedArgs, type KernelTool, type ModelSource } from '../../agent/src/lines/index.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WAIT_MS = 15_000;
export const SIZES = [[1440, 900], [768, 1024], [390, 844], [500, 500]] as const;

export interface Gates {
  release(what: string, result?: string): void;
  started: string[];
}

export interface Kernel {
  providers: FakeProviders;
  models: KernelModels;
  gates: Gates;
}

export interface StackOptions {
  steps?: TextStep[];
  app?: TestAppOptions;
  kernel?: { connected: boolean };
  hash?: string;
  client?: ClientName;
  realClock?: boolean;
  plugins?: Plugin[];
  beforeOpen?: (app: TestApp) => void | Promise<void>;
}

export interface Stack {
  app: TestApp;
  base: string;
  page: Cdp;
  browser: LocalBrowser;
  cookie: string;
  kernel: Kernel | null;
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
  t.after(async () => {
    await browser?.close();
    await vite?.close();
    await app.close();
  });
  if (options.realClock === true) {
    app.clock.advance(Date.now() - app.clock.now().getTime());
  }
  vite = await createServer({ root: CLIENT_ROOT, logLevel: 'error', plugins: options.plugins ?? [],
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

async function check(page: Cdp, expression: string): Promise<boolean> {
  try {
    return await page.evaluate<boolean>(`Boolean(${expression})`);
  } catch (error) {
    const switching = /navigated or closed|Execution context was destroyed/;
    if (error instanceof Error && switching.test(error.message)) return false;
    throw error;
  }
}

export async function until(page: Cdp, expression: string, label: string, ms = WAIT_MS): Promise<void> {
  const deadline = Date.now() + ms;
  while (!await check(page, expression)) {
    if (Date.now() > deadline) {
      const seen = await page.evaluate<string>(`location.hash + ' ' + (document.body?.innerText ?? '').slice(0, 600)`)
        .catch(() => '读不到页面');
      throw new Error(`浏览器等不到：${label}（页面：${JSON.stringify(seen)}）`);
    }
    await pause(30);
  }
}

export async function settle(done: () => boolean | Promise<boolean>, label: string, ms = WAIT_MS): Promise<void> {
  const deadline = Date.now() + ms;
  while (!await done()) {
    if (Date.now() > deadline) {
      throw new Error(`等不到：${label}`);
    }
    await pause(30);
  }
}

export function text(expected: string, scope = 'document.body'): string {
  const target = /^(document|\()/.test(scope) ? scope : `document.querySelector(${JSON.stringify(scope)})`;
  return `(${target})?.textContent.includes(${JSON.stringify(expected)})`;
}

export function button(label: string, scope = 'document'): string {
  return `Array.from((${scope})?.querySelectorAll('button, [role="menuitem"]') ?? []).find(node => !node.disabled
    && node.getClientRects().length > 0
    && ((node.getAttribute('aria-label') ?? '') === ${JSON.stringify(label)}
      || node.textContent.trim() === ${JSON.stringify(label)}))`;
}

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

export async function capture(page: Cdp, name: string): Promise<void> {
  const directory = process.env['PLASTICINE_BROWSER_EVIDENCE'];
  if (directory === undefined) {
    return;
  }
  await mkdir(directory, { recursive: true });
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, `${name}.png`), Buffer.from(String(shot['data']), 'base64'));
}

export async function layouts(page: Cdp, prefix: string, target: string, phone = true): Promise<void> {
  for (const [width, height] of SIZES.filter(([width]) => phone || width >= 768)) {
    for (const theme of ['light', 'dark']) {
      await size(page, width, height);
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
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
