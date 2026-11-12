// 装成客户端截图（2026-11-04 起统一用这一套，收了第 2 批各分支自带的截图小工具）。
// 用法：node scripts/browser/client-shots.ts <网址根> <输出目录> <jobs.json 文件或 JSON 字符串>
//   网址根是本地 Vite（假接口：cd client && npx vite --host 127.0.0.1 --port <端口> --strictPort），如
//   http://127.0.0.1:5191/。每张一个独立的浏览器上下文（标签、分组、本机存储不串到下一张）。
// job：{ name, client: 'mac' | 'phone' | 'web', hash: '#/today', theme?: 'light' | 'dark', steps?: Step[] }
// Step：一段 JS；{ wait: 毫秒 }；{ click: 选择器 }；{ clickText: 文字, within?: 选择器 }；
//   { hover: 选择器 }（真鼠标移过去，电脑上的跟随浮框、标签预览）；{ circle: 'answer' }（模拟原生圈好一块）。
// 截完逐张核对：网页调原生桥合不合协议、横向有没有溢出；有问题退出码 1。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { launchBrowser, type Cdp, type LocalBrowser } from './cdp.ts';
import { CLIENT_NAMES } from './client-profile.ts';
import { checkNativeCalls } from './fake-native.ts';
import { locateShotElement } from './shot-page.ts';

const StepSchema = Type.Union([
  Type.String({ minLength: 1 }),
  Type.Object({ wait: Type.Integer({ minimum: 0, maximum: 30_000 }) }, { additionalProperties: false }),
  Type.Object({ click: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object({ clickText: Type.String({ minLength: 1 }), within: Type.Optional(Type.String({ minLength: 1 })) },
    { additionalProperties: false }),
  Type.Object({ hover: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  /** 把这个元素滚到屏幕中间（长页面靠下的那一块）。 */
  Type.Object({ scroll: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object({ circle: Type.Literal('answer') }, { additionalProperties: false }),
]);
export type ShotStep = Static<typeof StepSchema>;

export const ShotJobSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120, pattern: '^[^/\\\\]+$' }),
  client: Type.Enum(CLIENT_NAMES),
  hash: Type.String({ pattern: '^(#/.*)?$' }),
  /** 加在网址根后面、hash 前面的查询，如 '?web=1'。 */
  query: Type.Optional(Type.String({ pattern: '^\\?[^#]*$' })),
  theme: Type.Optional(Type.Union([Type.Literal('light'), Type.Literal('dark')])),
  /** 主题预设（设置 · 通用 · 外观）：不给就是默认的暖纸。 */
  palette: Type.Optional(Type.Union([Type.Literal('graphite'), Type.Literal('pine'), Type.Literal('midnight')])),
  steps: Type.Optional(Type.Array(StepSchema)),
}, { additionalProperties: false });
export type ShotJob = Static<typeof ShotJobSchema>;

/** 应用挂上以后再等一会儿：字体、首屏数据、入场动效（已按减少动态效果）落定。 */
const SETTLE_MS = 600;
/** 每一步之后等这么久：点开的弹层、浮框出来。 */
const STEP_MS = 400;
/** 等应用挂上、等步骤里的元素出现最多这么久。 */
const READY_MS = 15_000;
const POLL_MS = 100;
/** 鼠标从左边几处移到元素中间：跟随浮框按 mousemove 出，一次跳过去有的组件收不到。 */
const HOVER_PATH = [-30, -6, -3, 0];
/** 鼠标停在元素上的位置：宽元素别停到太右边（行尾 ⋯ 在那里）。 */
const HOVER_MAX_X = 240;

export interface ShotResult {
  name: string;
  file: string;
  overflow: boolean;
  nativeCalls: number;
}

export function parseJobs(input: unknown): ShotJob[] {
  const schema = Type.Array(ShotJobSchema, { minItems: 1 });
  if (!Value.Check(schema, input)) {
    const first = Value.Errors(schema, input)[0];
    throw new Error(`截图清单不对：${first === undefined ? '' : `${first.instancePath} ${first.message}`}`);
  }
  const names = new Set<string>();
  for (const job of input) {
    if (names.has(job.name)) {
      throw new Error(`截图清单里「${job.name}」重名`);
    }
    names.add(job.name);
  }
  return input;
}

async function until(page: Cdp, expression: string, label: string): Promise<void> {
  const deadline = Date.now() + READY_MS;
  while (!await page.evaluate<boolean>(expression)) {
    if (Date.now() > deadline) {
      throw new Error(`等不到：${label}`);
    }
    await pause(POLL_MS);
  }
}

async function hover(page: Cdp, selector: string): Promise<void> {
  const point = await page.evaluate<{ x: number; y: number } | null>(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (element === null) { return null; }
    const box = element.getBoundingClientRect();
    return { x: box.left + Math.min(box.width / 2, ${HOVER_MAX_X}), y: box.top + box.height / 2 };
  })()`);
  if (point === null) {
    throw new Error(`没有可悬停的元素：${selector}`);
  }
  for (const dx of HOVER_PATH) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + dx, y: point.y });
    await pause(POLL_MS);
  }
}

async function runStep(page: Cdp, step: ShotStep): Promise<void> {
  if (typeof step === 'string') {
    await page.evaluate(step);
    return;
  }
  if ('wait' in step) {
    await pause(step.wait);
    return;
  }
  if ('click' in step) {
    await until(page, locateShotElement({ selector: step.click }, true), `点 ${step.click}`);
    return;
  }
  if ('clickText' in step) {
    const locator = step.within === undefined
      ? { text: step.clickText }
      : { text: step.clickText, within: step.within };
    await until(page, locateShotElement(locator, true), `点「${step.clickText}」`);
    return;
  }
  if ('scroll' in step) {
    await page.evaluate(`document.querySelector(${JSON.stringify(step.scroll)})?.scrollIntoView({ block: 'center' })`);
    return;
  }
  if ('hover' in step) {
    await hover(page, step.hover);
    return;
  }
  await page.evaluate('window.__plasticineFakeNative.circleAnswers = true');
}

export async function shootJob(browser: LocalBrowser, base: string, output: string, job: ShotJob): Promise<ShotResult> {
  const url = `${base.replace(/\/?$/, '/')}${job.query ?? ''}${job.hash}`;
  const page = await browser.page(url, job.client, { isolated: true });
  try {
    await page.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-color-scheme', value: job.theme ?? 'light' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ] });
    await until(page, `(document.getElementById('root')?.childElementCount ?? 0) > 0`, '应用挂上');
    if (job.palette !== undefined) {
      await page.evaluate(`document.documentElement.dataset.palette = ${JSON.stringify(job.palette)}`);
    }
    await page.evaluate('document.fonts.ready.then(() => true)');
    await pause(SETTLE_MS);
    for (const step of job.steps ?? []) {
      await runStep(page, step);
      await pause(STEP_MS);
    }
    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (typeof shot['data'] !== 'string') {
      throw new Error('Chromium 没有返回截图');
    }
    const file = join(output, `${job.name}.png`);
    await writeFile(file, Buffer.from(shot['data'], 'base64'));
    const overflow = await page.evaluate<boolean>('document.documentElement.scrollWidth > innerWidth');
    const calls = await checkNativeCalls(page);
    return { name: job.name, file, overflow, nativeCalls: calls.length };
  } finally {
    await page.send('Page.close');
    page.close();
  }
}

export async function clientShots(base: string, output: string, jobs: ShotJob[]): Promise<ShotResult[]> {
  await mkdir(output, { recursive: true });
  const browser = await launchBrowser();
  const results: ShotResult[] = [];
  try {
    for (const job of jobs) {
      results.push(await shootJob(browser, base, output, job));
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function readJobs(argument: string): Promise<unknown> {
  const source = argument.trimStart().startsWith('[') ? argument : await readFile(argument, 'utf8');
  return JSON.parse(source) as unknown;
}

async function main(args: string[]): Promise<number> {
  const [base, output, jobsArgument] = args;
  if (base === undefined || output === undefined || jobsArgument === undefined) {
    console.error('用法：node scripts/browser/client-shots.ts <网址根> <输出目录> <jobs.json 或 JSON>');
    return 2;
  }
  const jobs = parseJobs(await readJobs(jobsArgument));
  const results = await clientShots(base, output, jobs);
  for (const result of results) {
    const notes = [result.overflow ? '横向溢出' : '', `调桥 ${result.nativeCalls} 次`].filter((note) => note !== '');
    console.log(`${result.file}（${notes.join('，')}）`);
  }
  return results.some((result) => result.overflow) ? 1 : 0;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
