// Mac 原生壳和网页界面之间的桥（mac/README.md「网页桥接」）。Swift 侧按这里的形状收发，网页侧从这里导入类型。
// 网页标签和翻译这两份 iPhone 0.2.0 起也用（文件末尾 PlasticineIOSBridge）。
//
// 第 102 条第 3 批：网页标签由原生 WKWebView 画在中间区上面（独立的数据存储，用户自己的登录留在 Mac 上）。
// 网页 → 原生：window.plasticineMac.webTabs 的四个方法，都经 `plasticineTabs` 消息通道，只收本站主 frame 的消息：
//   sync(WebTabsSync)                  标签清单、哪一个在前、中间区的位置和大小（CSS 像素，相对主窗口网页的视口），
//                                      以及盖在网页标签上的浮层矩形 hitRegions。每次标签、布局、浮层变化都发一整份；
//                                      frame 或 active 为 null 时原生层全部隐藏。
// 2026-11-03 起（Mac 0.3.0，用户定「对话框盖在网页上」）：原生网页标签垫在主网页下面，主网页在网页标签那一块不画底色
//   （透明，露出下面的原生网页）。点击按 hitRegions 分：落在任何一个 hitRegions 矩形里的交给主网页（对话框、圆球、
//   菜单、弹层），其余落在 frame 里的交给网页标签。新网页界面每次 sync 都带 hitRegions（没有浮层就是 []）——原生据此
//   认出新界面：带了才垫到下面、主网页透明；不带就照 0.2.x 把网页标签叠在主网页上面。对话框拖动、改大小、
//   展开收起的过程中每帧同步一次（requestAnimationFrame 节流）。
//   command(tabId, WebTabCommand)      后退、前进、刷新、停止、在系统浏览器打开。
//   navigate(tabId, url)               地址栏回车（网页侧先规整成 http(s) 地址）。
//   snapshot(tabId) → WebPageSnapshot  「问这一页」：标题、地址、可见正文（超过 WEB_PAGE_TEXT_MAX_CHARS 截断并标明）。
// 原生 → 网页：调 window.__plasticineWebTabEvent(WebTabEvent)：
//   state   某个标签的地址、标题、能不能后退前进、是否在载入；
//   opened  原生层开了一个新标签（网页里的新窗口、target=_blank，或 Plasticine 的 tab_open），网页把它加进标签清单；
//   closed  网页自己 window.close() 了。
//   icon    （11-08 加）这个标签的网站图标变了：{ tabId, pageUrl, icon: 'data:image/…' }（desktop-bridge.ts 的
//           WebTabIconEventSchema，≤ 64 KB）。Electron 壳听 page-favicon-updated 报；Swift Mac App 不报，网页侧就用本体代取的
//           （/v2/favicon）。网页收到后当这个标签的图标，并按 pageUrl 的域名存进本体的图标缓存，别的设备也用上。
//   operate 第 3 批「问这一页 → 操作整页」：Plasticine 在这个标签里做的一步（page-operate.ts 的 PageOperateEvent），
//           对话框里列出来；同一个 actionId 先报 run，做完报 done，提交没放行报 wait，没做成报 err。

import { Type, type Static } from 'typebox';
import { CONVERSATION_ATTACHMENT_MAX_BYTES, CONVERSATION_ATTACHMENT_MAX_COUNT } from './attachments.ts';
import { PageOperateEventSchema } from './page-operate.ts';
import { WebTabIconEventSchema } from './desktop-bridge.ts';

export const MacAttachFilesSchema = Type.Array(Type.Object({
  name: Type.String({ minLength: 1 }),
  type: Type.String(),
  base64: Type.String({ maxLength: Math.ceil(CONVERSATION_ATTACHMENT_MAX_BYTES / 3) * 4 }),
}, { additionalProperties: false }), { maxItems: CONVERSATION_ATTACHMENT_MAX_COUNT });
export type MacAttachedFile = Static<typeof MacAttachFilesSchema>[number];

const STRICT = { additionalProperties: false };
const TabId = Type.String({ minLength: 1, maxLength: 100 });
// 一次最多开着这么多个网页标签同步给原生层：再多是失控，不是正常浏览。
export const WEB_TABS_MAX = 50;
// 「问这一页」的正文上限：对话一次引用合计 12 万字（conversation-quotes.ts），留 2 万给别的引用和标题地址。
export const WEB_PAGE_TEXT_MAX_CHARS = 100_000;

export const WebTabFrameSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number({ minimum: 0 }),
  height: Type.Number({ minimum: 0 }),
}, STRICT);
export type WebTabFrame = Static<typeof WebTabFrameSchema>;

/** 一次最多报这么多个浮层矩形（和顶栏不可拖动区同一上限）。 */
export const HIT_REGIONS_MAX = 200;

export const WebTabsSyncSchema = Type.Object({
  tabs: Type.Array(Type.Object({ tabId: TabId, url: Type.String({ minLength: 1, maxLength: 4_096 }),
    openedBy: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('plasticine')])) }, STRICT),
    { maxItems: WEB_TABS_MAX }),
  active: Type.Union([TabId, Type.Null()]),
  frame: Type.Union([WebTabFrameSchema, Type.Null()]),
  /**
   * 盖在网页标签上、要主网页自己接收点击的矩形（和 frame 同一坐标系）。可选只是为了认出 0.2.x 的旧网页界面：
   * 新界面每次都带，没有浮层发 []。
   */
  hitRegions: Type.Optional(Type.Array(WebTabFrameSchema, { maxItems: HIT_REGIONS_MAX })),
}, STRICT);
export type WebTabsSync = Static<typeof WebTabsSyncSchema>;

export const WEB_TAB_COMMANDS = ['back', 'forward', 'reload', 'stop', 'open_external', 'close'] as const;
export type WebTabCommand = (typeof WEB_TAB_COMMANDS)[number];

export const WebPageSnapshotSchema = Type.Object({
  tabId: TabId,
  url: Type.String(),
  title: Type.String(),
  text: Type.String(),
  /** 原文有多少字（Unicode 字符）；比 text 长就是截断了。 */
  totalChars: Type.Integer({ minimum: 0 }),
  truncated: Type.Boolean(),
}, STRICT);
export type WebPageSnapshot = Static<typeof WebPageSnapshotSchema>;

export const WebTabEventSchema = Type.Union([
  Type.Object({
    type: Type.Literal('state'),
    tabId: TabId,
    url: Type.String(),
    title: Type.String(),
    canGoBack: Type.Boolean(),
    canGoForward: Type.Boolean(),
    loading: Type.Boolean(),
  }, STRICT),
  Type.Object({
    type: Type.Literal('opened'),
    tabId: TabId,
    url: Type.String(),
    title: Type.String(),
    openedBy: Type.Union([Type.Literal('user'), Type.Literal('plasticine')]),
    /** 用户点出来的新窗口切过去；Plasticine 在后台开的不抢用户正看着的标签。 */
    activate: Type.Boolean(),
  }, STRICT),
  Type.Object({ type: Type.Literal('closed'), tabId: TabId }, STRICT),
  WebTabIconEventSchema,
  Type.Object({ type: Type.Literal('internal'), hash: Type.String({ pattern: '^#/' }) }, STRICT),
  PageOperateEventSchema,
]);
export type WebTabEvent = Static<typeof WebTabEventSchema>;

export interface PlasticineMacWebTabs {
  sync(state: WebTabsSync): void;
  command(tabId: string, command: WebTabCommand): void;
  navigate(tabId: string, url: string): void;
  /** 回的是未校验的数据，网页侧按 WebPageSnapshotSchema 校验后再用。 */
  snapshot(tabId: string): Promise<unknown>;
  /** 第 2 批「浏览器」起才有：原生会做的网页工具（web-page-tools.ts 的 WEB_PAGE_TOOLS 子集）。 */
  tools?: readonly string[];
  /** 第 2 批「浏览器」起才有：做一样网页工具；回的是未校验的数据，网页侧按 web-page-tools.ts 校验后再用。 */
  tool?(tabId: string, tool: import('./web-page-tools.ts').WebPageTool): Promise<unknown>;
}

// 窗口外观（2026-11-03，Mac 0.3.0：交通灯并进 Plasticine 自己的顶栏，只加不改）。原生侧窗口用 fullSizeContentView +
// 透明标题栏 + 隐藏标题，交通灯竖直居中在顶栏（TITLEBAR_HEIGHT）里；网页侧在顶栏最左边留出交通灯的安全区。
// 原生 → 网页：window.plasticineMac.windowChrome.current() 同步回 WindowChrome（还没换外观时也回 78，全屏为 0）；
//   换外观、进出全屏时调 window.__plasticineWindowChrome(WindowChrome)（原生内部另有 __plasticineNativeWindowChrome，
//   网页不用管）。
// 网页 → 原生：windowChrome.titlebar(TitlebarLayout) 经消息通道 `plasticineChrome` 发
//   { type: 'titlebar', layout: TitlebarLayout }，不要回执。网页加载时有 windowChrome 就调一次，布局变了再报一整份；
//   网页第一次调 titlebar 时窗口才换成无系统标题栏的外观。顶栏可拖动区 = 顶栏矩形（高 height、整宽）减去 noDrag 矩形
//   （按钮、标签、地址栏），由原生处理拖动窗口（双击照系统设置缩放）；WKWebView 里 -webkit-app-region 不起作用。
/** 网页顶栏的高度（CSS 像素）：交通灯的中线对齐它的中线。 */
export const TITLEBAR_HEIGHT = 44;
/** 没有原生报值时交通灯安全区的默认宽度：三个灯 + 左右留白。 */
export const TRAFFIC_LIGHT_INSET_DEFAULT = 78;

export const WindowChromeSchema = Type.Object({
  /** 顶栏最左边要让出来的宽度；全屏时为 0。两层侧栏（11-07）起大于 0 时图标栏顶上留出交通灯的位置。 */
  trafficLightInset: Type.Number({ minimum: 0, maximum: 200 }),
  fullScreen: Type.Boolean(),
  /**
   * 窗口按钮画在右上角时要让出来的宽度（Windows 的最小化、最大化、关闭，11-07 设计稿 Windows-Web）。Mac 不报（0）；
   * 第四段的 Electron 壳在 Windows 上报。
   */
  controlsRight: Type.Optional(Type.Number({ minimum: 0, maximum: 400 })),
}, STRICT);
export type WindowChrome = Static<typeof WindowChromeSchema>;

export const TitlebarLayoutSchema = Type.Object({
  height: Type.Number({ minimum: 0, maximum: 400 }),
  /** 不可拖动的矩形（按钮、标签、地址栏），相对网页视口；其余顶栏区域可拖动窗口。 */
  noDrag: Type.Array(WebTabFrameSchema, { maxItems: HIT_REGIONS_MAX }),
}, STRICT);
export type TitlebarLayout = Static<typeof TitlebarLayoutSchema>;

/** `plasticineChrome` 消息通道上的消息体（window.plasticineMac.windowChrome.titlebar 发的就是它）。 */
export const ChromeMessageSchema = Type.Object({
  type: Type.Literal('titlebar'),
  layout: TitlebarLayoutSchema,
}, STRICT);
export type ChromeMessage = Static<typeof ChromeMessageSchema>;

export interface PlasticineMacWindowChrome {
  /** 回的是未校验的数据，网页侧按 WindowChromeSchema 校验后再用。 */
  current(): unknown;
  titlebar(layout: TitlebarLayout): void;
}

export interface PlasticineMacBridge {
  version: string;
  notify(title: string, body: string, hash: string): void;
  /** 0.2.0 起才有：没有它的旧 App 里网页标签照旧在系统浏览器打开。 */
  webTabs?: PlasticineMacWebTabs;
  /** 0.3.0 起（交通灯并进顶栏）才有；没有它时照旧是系统标题栏，网页顶栏不留安全区。 */
  windowChrome?: PlasticineMacWindowChrome;
  /** 0.4.0 起（沉浸式翻译，mac-translate.ts）才有；没有它时网页工具条上不出「文A」。 */
  translate?: import('./mac-translate.ts').PlasticineMacTranslate;
  /** 第 3 批起才有：这台 Mac 上登录着的网站、从 Chrome / Safari 搬一次登录（mac-logins.ts）。 */
  logins?: import('./mac-logins.ts').PlasticineMacLogins;
}

// iPhone 原生壳（ios/，第 102 条第 4 批）注入 window.plasticineIOS。网页用它打开原生页面：设置与自检、拍照、语音；
// 「问 Plasticine」（快捷指令 / Siri）由 App 调 window.__plasticineAsk(text) 发到对话里。
// iPhone 0.2.0 起（第 114 条，第 3 批「iPhone 外链」）：站外链接开成 Plasticine 自己的网页标签，和 Mac 用同一份协议——
// webTabs（上面的 WebTabsSync / WebTabCommand / WebPageSnapshot，消息通道同名 `plasticineTabs`）和 translate
// （mac-translate.ts，通道 `plasticineTranslate`），原生 → 网页的事件也是同一对 window.__plasticineWebTabEvent /
// __plasticineTranslateEvent。平台差别只在原生层：每次 sync 都按 hitRegions 垫在主网页下面；不在前的标签用到时才载入；
// open_external 交给 Safari；左右滑前进后退、下拉重新载入由原生网页自己做。没有 webTabs 的旧 App 外链照旧跳出去。
export const IOS_NATIVE_PAGES = ['settings', 'photo', 'voice'] as const;
export type IosNativePage = (typeof IOS_NATIVE_PAGES)[number];
// 「问 Plasticine」一句话的上限：和快捷指令输入同档。
export const IOS_ASK_MAX_CHARS = 4_000;

export interface PlasticineIOSBridge {
  version: string;
  open(page: IosNativePage): void;
  /** 0.2.0 起才有：网页标签（和 Mac 同一份协议）。 */
  webTabs?: PlasticineMacWebTabs;
  /** 0.2.0 起才有：沉浸式翻译（mac-translate.ts）。 */
  translate?: import('./mac-translate.ts').PlasticineMacTranslate;
}
