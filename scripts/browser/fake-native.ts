// 模拟的原生桥：验收和截图时把无头 Chromium 装成 Mac / iPhone 客户端（2026-11-04 他定）。
// 形状按 agent/shared/api/mac-bridge.ts 的 PlasticineMacBridge / PlasticineIOSBridge 写，类型检查管住方法和参数；
// 网页每次调桥都记下来（window.__plasticineFakeNative.calls），验收结束时 checkNativeCalls 按共享 schema 逐条校验，
// 协议一改，模拟的客户端和用它的验收就跟着失败。
// 网页标签不真开（原生 WKWebView 在这里没有），只按协议回状态、快照和工具回执；画面是一张画出来的「网页」。

import { deflateSync, crc32 } from 'node:zlib';
import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import {
  ChromeMessageSchema, IOS_NATIVE_PAGES, WEB_TAB_COMMANDS, WebTabEventSchema, WebTabsSyncSchema,
  type PlasticineIOSBridge, type PlasticineMacBridge, type WebPageSnapshot, type WebTabEvent, type WebTabsSync,
  type WindowChrome,
} from '../../agent/shared/api/mac-bridge.ts';
import { TranslateDeliverySchema, TranslateEventSchema, TranslatePageConfigSchema,
  type TranslateEvent } from '../../agent/shared/api/mac-translate.ts';
import { WEB_THUMBNAIL_WIDTH, WebPageToolSchema, type WebCircleResult, type WebPageImage,
  type WebPageTool, type WebPageToolName } from '../../agent/shared/api/web-page-tools.ts';
import { LoginImportRequestSchema, type LoginImportResult, type LoginSource,
  type SiteLogin } from '../../agent/shared/api/mac-logins.ts';
import type { ClientProfile, NativeKind } from './client-profile.ts';

/** 模拟网页标签里那一页的内容：「问这一页」、阅读模式、圈一块都从这里取。 */
export interface FakePage {
  url: string;
  title: string;
  text: string;
}

export interface FakeNativeConfig {
  kind: NativeKind;
  version: string;
  tools: WebPageToolName[];
  page: FakePage;
  image: WebPageImage;
  circle: WebCircleResult;
  chrome: WindowChrome;
  /** Mac 的登录（第 3 批，mac-logins.ts）：登录着的网站、能从哪儿导入、导入一次的结果。 */
  logins: { sites: SiteLogin[]; sources: LoginSource[]; result: LoginImportResult };
}

/** 网页调桥的一次记录。channel 是原生那边的消息通道名（mac-bridge.ts、mac-translate.ts）。 */
export interface NativeCall {
  channel: 'plasticineTabs' | 'plasticineTranslate' | 'plasticineChrome' | 'plasticineMac' | 'plasticineLogins'
    | 'plasticine';
  method: string;
  args: unknown[];
}

/** 页面里 window.__plasticineFakeNative：调用记录，和验收脚本拨的几个开关。 */
export interface FakeNativeRecord {
  calls: NativeCall[];
  /** 圈一块：false（默认）一直等着，像用户还没框；true 时 400 毫秒后回圈好的那一块。 */
  circleAnswers: boolean;
}

/** 页面全局里模拟桥要碰的几样（脚本在浏览器里跑，根 tsconfig 没有 DOM 类型，只写用到的）。 */
interface FakeHost {
  plasticineDesktop?: PlasticineMacBridge;
  plasticineIOS?: PlasticineIOSBridge;
  __plasticineWebTabEvent?: (event: unknown) => void;
  __plasticineFakeNative?: FakeNativeRecord;
  document?: FakeDocument;
}

interface FakeContext {
  fillStyle: string;
  font: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

interface FakeCanvas {
  width: number;
  height: number;
  style: { cssText: string; display: string };
  getContext(kind: '2d'): FakeContext | null;
}

interface FakeDocument {
  createElement(tag: 'canvas'): FakeCanvas;
  documentElement: { append(node: FakeCanvas): void };
}

type PaintPage = (host: FakeHost, frame: WebTabsSync['frame'], page: FakePage, marks?: string[]) => void;

// 原生网页标签垫在主网页下面，主网页在那一块透明（mac-bridge.ts，Mac 0.3.0 起）。这里在同一块画一页文章，
// 截图里网页工具条下面才有东西。画在 canvas 上：文字不进 DOM，验收按文字找元素时不会误中；不接点击。
// 同 installFakeNative 一样被 toString 注入，只能用参数和浏览器全局。
function paintFakePage(host: FakeHost, frame: WebTabsSync['frame'], page: FakePage, marks: string[] = []): void {
  const id = '__plasticineFakeNativePage';
  const store = host as FakeHost & { [id]?: FakeCanvas };
  const document = host.document;
  if (document === undefined) {
    return;
  }
  let canvas = store[id];
  if (canvas === undefined) {
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;z-index:-1;pointer-events:none;background:#fff;';
    document.documentElement.append(canvas);
    store[id] = canvas;
  }
  if (frame === null || frame.width === 0 || frame.height === 0) {
    canvas.style.display = 'none';
    return;
  }
  canvas.style.cssText = `position:fixed;z-index:-1;pointer-events:none;background:#fff;left:${frame.x}px;`
    + `top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;display:block;`;
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    return;
  }
  const font = '"PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';
  const column = Math.min(frame.width - 48, 680);
  const left = Math.max(24, (frame.width - column) / 2);
  let top = 56;
  const [site = '', title = '', meta = '', ...paragraphs] = page.text.split('\n');
  const write = (text: string, size: number, color: string, weight: string, gap: number): void => {
    const highlighted = marks.some((quote) => text.includes(quote));
    const lineAt = (line: string): void => {
      if (highlighted) { context.fillStyle = '#f4e8c7';
        context.fillRect(left, top - size, context.measureText(line).width, size * 1.3); }
      context.fillStyle = color; context.fillText(line, left, top);
    };
    context.font = `${weight} ${size}px ${font}`;
    context.fillStyle = color;
    let line = '';
    for (const char of text) {
      // 句读和后引号不放到行首（中文排版的避头），宁可这一行稍微超出一点。
      if (context.measureText(line + char).width > column && line !== '' && !'，。、；：？！」』）'.includes(char)) {
        lineAt(line);
        top += size * 1.7;
        line = '';
      }
      line += char;
    }
    lineAt(line);
    top += size * 1.7 + gap;
  };
  write(site, 13, '#8a8a85', '600', 18);
  write(title, 28, '#1d1d1b', '700', 6);
  write(meta, 13, '#8a8a85', '400', 22);
  for (const paragraph of paragraphs) {
    write(paragraph, 16, '#2b2b28', '400', 14);
  }
}

// 这一段被 toString 后注入页面（Page.addScriptToEvaluateOnNewDocument），只能用参数和浏览器全局，不能引用本文件别处。
// 在页面里 host 就是 window。
function installFakeNative(host: FakeHost, config: FakeNativeConfig, paint: PaintPage): void {
  // 「圈一块」框好以后回结果的延迟：给验收和截图留出「正在圈」的那一刻。
  const circleDelayMs = 400;
  // 原生载入一页后报状态的延迟：网页先记下新标签，再收到它的地址和标题。
  const stateDelayMs = 50;
  const record: FakeNativeRecord = { calls: [], circleAnswers: false };
  host.__plasticineFakeNative = record;
  const note = (channel: NativeCall['channel'], method: string, args: unknown[]): void => {
    record.calls.push({ channel, method, args: JSON.parse(JSON.stringify(args)) as unknown[] });
  };
  const emit = (event: WebTabEvent): void => {
    setTimeout(() => {
      if (typeof host.__plasticineWebTabEvent === 'function') {
        host.__plasticineWebTabEvent(event);
      }
    }, stateDelayMs);
  };
  const loaded = (tabId: string, url: string): void => {
    const title = url === config.page.url ? config.page.title : '';
    emit({ type: 'state', tabId, url, title, canGoBack: true, canGoForward: false, loading: false });
  };
  const known = new Set<string>();
  let latestFrame: WebTabsSync['frame'] = null;
  let highlights: string[] = [];
  let cancelCircle: (() => void) | null = null;
  const tool = (tabId: string, request: WebPageTool): Promise<unknown> => {
    note('plasticineTabs', 'tool', [tabId, request]);
    if (request.kind === 'extract_images') return Promise.resolve([]);
    if (request.kind === 'extract_marks') {
      highlights = request.points.map((point) => point.quote);
      paint(host, latestFrame, config.page, highlights);
      return Promise.resolve({ marked: highlights.length });
    }
    if (request.kind === 'find') {
      return Promise.resolve({ found: config.page.text.includes(request.query) });
    }
    if (request.kind === 'capture' || request.kind === 'thumbnail') {
      return Promise.resolve(config.image);
    }
    if (request.kind === 'circle') {
      return new Promise((resolve) => {
        cancelCircle = () => resolve(null);
        if (record.circleAnswers) {
          setTimeout(() => resolve(config.circle), circleDelayMs);
        }
      });
    }
    if (request.kind === 'circle_cancel') {
      cancelCircle?.();
      cancelCircle = null;
    }
    return Promise.resolve(true);
  };
  const webTabs = {
    sync(state) {
      note('plasticineTabs', 'sync', [state]);
      latestFrame = state.active === null ? null : state.frame;
      paint(host, latestFrame, config.page, highlights);
      for (const tab of state.tabs) {
        if (!known.has(tab.tabId)) {
          known.add(tab.tabId);
          loaded(tab.tabId, tab.url);
        }
      }
    },
    command(tabId, command) {
      note('plasticineTabs', 'command', [tabId, command]);
    },
    navigate(tabId, url) {
      note('plasticineTabs', 'navigate', [tabId, url]);
      loaded(tabId, url);
    },
    snapshot(tabId) {
      note('plasticineTabs', 'snapshot', [tabId]);
      const total = [...config.page.text].length;
      const snapshot: WebPageSnapshot = { tabId, url: config.page.url, title: config.page.title,
        text: config.page.text, totalChars: total, truncated: false };
      return Promise.resolve(snapshot);
    },
    tools: Object.freeze([...config.tools]),
    tool,
  } satisfies NonNullable<PlasticineMacBridge['webTabs']>;
  const translate = {
    configure(tabId, pageConfig) {
      note('plasticineTranslate', 'configure', [tabId, pageConfig]);
    },
    deliver(tabId, delivery) {
      note('plasticineTranslate', 'deliver', [tabId, delivery]);
    },
  } satisfies NonNullable<PlasticineMacBridge['translate']>;
  const logins = {
    sites() {
      note('plasticineLogins', 'sites', []);
      return Promise.resolve({ sites: config.logins.sites });
    },
    sources() {
      note('plasticineLogins', 'sources', []);
      return Promise.resolve({ sources: config.logins.sources });
    },
    import(request) {
      note('plasticineLogins', 'import', [request]);
      return Promise.resolve({ ...config.logins.result });
    },
    forget(site) {
      note('plasticineLogins', 'forget', [site]);
      return Promise.resolve(true);
    },
    openFullDiskAccess() {
      note('plasticineLogins', 'openFullDiskAccess', []);
    },
  } satisfies NonNullable<PlasticineMacBridge['logins']>;
  if (config.kind === 'mac') {
    host.plasticineDesktop = {
      version: config.version,
      notify(title, body, hash) {
        note('plasticineMac', 'notify', [title, body, hash]);
      },
      webTabs,
      translate,
      logins,
      windowChrome: {
        current() {
          return { ...config.chrome };
        },
        titlebar(layout) {
          note('plasticineChrome', 'titlebar', [layout]);
        },
      },
    };
    return;
  }
  host.plasticineIOS = {
    version: config.version,
    open(page) {
      note('plasticine', 'open', [page]);
    },
    webTabs,
    translate,
  };
}

/** 注入页面的脚本：在任何网页脚本之前装好桥。 */
export function fakeNativeScript(config: FakeNativeConfig): string {
  return `(${installFakeNative.toString()})(window, ${JSON.stringify(config)}, ${paintFakePage.toString()});`;
}

// 模拟网页的内容：和第 2 批设计稿 Web-* 画板里那篇博客同一段（示例文字）。
export const FAKE_PAGE: FakePage = {
  url: 'https://blog.example.org/local-first-sync',
  title: '本地优先软件的同步难题',
  text: [
    '慢工博客', '本地优先软件的同步难题', '2026 年 10 月 28 日 · 阅读约 12 分钟',
    '把数据放在自己的设备上，离线也能用，这是本地优先软件最吸引人的地方。麻烦在于：同一份文档在两台设备上各改了一遍，'
      + '联网之后该听谁的？',
    '过去十年，大多数应用的答案是「以服务器为准」。本地优先反过来：每台设备都是完整的副本，服务器只负责转发。',
    '冲突从哪里来',
    '冲突并不罕见。手机在地铁里改了标题，电脑上同时改了正文，这两处本可以合并；真正难办的是两边改了同一句话。',
  ].join('\n'),
};

// 模拟的登录（示例）：几个登录着的网站，Chrome 能直接导、Safari 要先给完全磁盘访问。按 0.7.0 起的 App 回：
// 只记登录状态，password / passwords 一律 false / 0（11-05 第 6 条，全部不用钥匙串）。
const FAKE_LOGINS: FakeNativeConfig['logins'] = {
  sites: [
    { host: 'x.com', name: 'X', password: false, since: '2026-11-02T09:00:00.000Z' },
    { host: 'github.com', name: 'GitHub', password: false, since: '2026-10-28T09:00:00.000Z' },
    { host: 'cloud.tencent.com', name: '腾讯云', password: false, since: '2026-10-20T09:00:00.000Z' },
    { host: 'race.example.cn', name: '城市马拉松', password: false, since: null },
  ],
  sources: [
    { id: 'chrome', available: true, profile: '默认个人资料', sites: 214, needs: null, passwords: false },
    { id: 'safari', available: true, profile: null, sites: null, needs: 'full_disk_access', passwords: false },
  ],
  result: { sites: 120, cookies: 1840, passwords: 0, skipped: 4, problem: null },
};

/** Swift Mac App 报的红绿灯让出宽度（78；Electron 壳按系统版本报，见 desktop/src/app/traffic-lights.ts）。 */
const MAC_TRAFFIC_LIGHT_INSET = 78;
// 画出来的「网页」：白底、一条标题、八行正文的灰条，宽按悬停预览缩略图（WEB_THUMBNAIL_WIDTH）。
const PICTURE_HEIGHT = 320;
const PICTURE_MARGIN = 32;
const PICTURE_TITLE = { top: 28, height: 16, width: 300, shade: 0xcf };
const PICTURE_LINES = { top: 70, step: 26, height: 8, shade: 0xe6, widths: [92, 70, 84, 60, 88, 40, 76, 66] };

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** 灰度 PNG：shade(x, y) 给每个像素的灰度。 */
export function grayPng(width: number, height: number, shade: (x: number, y: number) => number): Buffer {
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * (width + 1);
    rows[start] = 0;
    for (let x = 0; x < width; x += 1) {
      rows[start + 1 + x] = shade(x, y);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0))]);
}

function pagePicture(): WebPageImage {
  const width = WEB_THUMBNAIL_WIDTH;
  const usable = width - PICTURE_MARGIN * 2;
  const png = grayPng(width, PICTURE_HEIGHT, (x, y) => {
    const title = PICTURE_TITLE;
    if (y >= title.top && y < title.top + title.height && x >= PICTURE_MARGIN && x < PICTURE_MARGIN + title.width) {
      return title.shade;
    }
    const lines = PICTURE_LINES;
    const index = Math.floor((y - lines.top) / lines.step);
    const percent = lines.widths[index];
    const inLine = y >= lines.top && (y - lines.top) % lines.step < lines.height;
    if (percent !== undefined && inLine && x >= PICTURE_MARGIN && x < PICTURE_MARGIN + usable * percent / 100) {
      return lines.shade;
    }
    return 0xff;
  });
  return { type: 'image/png', base64: png.toString('base64') };
}

export function fakeNativeConfig(profile: ClientProfile): FakeNativeConfig | null {
  if (profile.native === null) {
    return null;
  }
  const paragraph = FAKE_PAGE.text.split('\n')[3] ?? FAKE_PAGE.title;
  return {
    kind: profile.native,
    version: profile.nativeVersion,
    tools: profile.tools,
    page: FAKE_PAGE,
    image: pagePicture(),
    circle: { text: paragraph, url: FAKE_PAGE.url, title: FAKE_PAGE.title },
    chrome: { trafficLightInset: MAC_TRAFFIC_LIGHT_INSET, fullScreen: false },
    logins: FAKE_LOGINS,
  };
}

// ---- 验收脚本这一侧：读调用记录并按协议校验、替原生发事件 ----

interface PageLike {
  evaluate<T>(expression: string): Promise<T>;
}

function schemaProblem(schema: TSchema, value: unknown): string | null {
  if (Value.Check(schema, value)) {
    return null;
  }
  const first = Value.Errors(schema, value)[0];
  return first === undefined ? '形状不对' : `${first.instancePath || '/'} ${first.message}`;
}

function oneOf(values: readonly string[], value: unknown): string | null {
  return typeof value === 'string' && values.includes(value) ? null : `不是 ${values.join(' / ')} 之一`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? null : '不是非空字符串';
}

/** 一次调桥合不合协议；合就回 null，不合回一句原因。 */
export function nativeCallProblem(call: NativeCall): string | null {
  const [first, second] = call.args;
  const key = `${call.channel}.${call.method}`;
  const checks: Record<string, () => string | null> = {
    'plasticineTabs.sync': () => schemaProblem(WebTabsSyncSchema, first),
    'plasticineTabs.command': () => text(first) ?? oneOf(WEB_TAB_COMMANDS, second),
    'plasticineTabs.navigate': () => text(first) ?? text(second),
    'plasticineTabs.snapshot': () => text(first),
    'plasticineTabs.tool': () => text(first) ?? schemaProblem(WebPageToolSchema, second),
    'plasticineTranslate.configure': () => text(first)
      ?? (second === null ? null : schemaProblem(TranslatePageConfigSchema, second)),
    'plasticineTranslate.deliver': () => text(first) ?? schemaProblem(TranslateDeliverySchema, second),
    'plasticineChrome.titlebar': () => schemaProblem(ChromeMessageSchema, { type: 'titlebar', layout: first }),
    'plasticineMac.notify': () => text(first) ?? (typeof second === 'string' ? null : '正文不是字符串'),
    'plasticineLogins.sites': () => null,
    'plasticineLogins.sources': () => null,
    'plasticineLogins.import': () => schemaProblem(LoginImportRequestSchema, first),
    'plasticineLogins.forget': () => text(first),
    'plasticineLogins.openFullDiskAccess': () => null,
    'plasticine.open': () => oneOf(IOS_NATIVE_PAGES, first),
  };
  const check = checks[key];
  return check === undefined ? `桥上没有 ${key}` : check();
}

/** 读这一页调过的桥。不是客户端（没注入桥）回空。 */
export async function nativeCalls(page: PageLike): Promise<NativeCall[]> {
  return page.evaluate<NativeCall[]>('window.__plasticineFakeNative?.calls ?? []');
}

/** 这一页调桥有没有不合协议的；有就抛错，把每一条列出来。 */
export async function checkNativeCalls(page: PageLike): Promise<NativeCall[]> {
  const calls = await nativeCalls(page);
  const problems = calls.flatMap((call) => {
    const problem = nativeCallProblem(call);
    return problem === null ? [] : [`${call.channel}.${call.method}：${problem}`];
  });
  if (problems.length > 0) {
    throw new Error(`网页调原生桥不合协议（agent/shared/api/mac-bridge.ts）：\n${problems.join('\n')}`);
  }
  return calls;
}

/** 替原生发一个网页标签事件（先按 WebTabEventSchema 校验，模拟的原生也不能发协议外的东西）。 */
export async function emitWebTabEvent(page: PageLike, event: WebTabEvent): Promise<void> {
  const problem = schemaProblem(WebTabEventSchema, event);
  if (problem !== null) {
    throw new Error(`模拟的原生事件不合协议：${problem}`);
  }
  await page.evaluate(`window.__plasticineWebTabEvent?.(${JSON.stringify(event)})`);
}

/** 替原生报一声「点在网页标签上」（web-window.swift 的 nativePointer；没有参数，浮层听 plasticine:native-pointer 收起）。 */
export async function emitNativePointer(page: PageLike): Promise<void> {
  await page.evaluate('window.__plasticineNativePointer?.()');
}

/** 替原生发一个翻译事件（TranslateEventSchema）。 */
export async function emitTranslateEvent(page: PageLike, event: TranslateEvent): Promise<void> {
  const problem = schemaProblem(TranslateEventSchema, event);
  if (problem !== null) {
    throw new Error(`模拟的翻译事件不合协议：${problem}`);
  }
  await page.evaluate(`window.__plasticineTranslateEvent?.(${JSON.stringify(event)})`);
}
