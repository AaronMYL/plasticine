// 网页工具（2026-11-04 第 2 批「浏览器」，设计稿 Web-Menu / Web-Ask / Web-Preview）：网页工具条 ⋯ 菜单、「圈一块」、
// 标签悬停预览里要原生网页标签（Mac WKWebView、iPhone WKWebView）做的几样。和 mac-bridge.ts 的 webTabs 同一个
// `plasticineTabs` 消息通道，消息是 { type: 'tool', tabId, tool: WebPageTool }，都要回执。
//
// 原生在注入的 webTabs.tools 里报自己会哪几样（WEB_PAGE_TOOLS 的子集）；网页侧只显示报了的菜单项（没报的不显示，
// 不置灰）。各样的回执（网页侧按下面的 schema 校验后再用）：
//   find          在页面中查找 query（backwards 往回找），回 WebFindResult；find_clear 收起高亮，回 true。
//   zoom          页面缩放（WKWebView.pageZoom），回 true。按网站记住在网页侧（state/tabs-zoom.ts），换网站时网页侧再发。
//   capture       截图，scope = visible 可见部分 / full 整页（原生报 capture_full 才有整页），回 WebPageImage。
//   print         存成 PDF / 打印：原生弹系统的打印面板（里面能存成 PDF），回 true。
//   circle        圈一块：在网页上框一块或点一个元素，回 WebCircleResult；按 Esc 或网页侧发 circle_cancel 回 null。
//   thumbnail     标签悬停预览的缩略图（宽 WEB_THUMBNAIL_WIDTH），截不到回 null（网页侧就不放缩略图）。
//   downloads     下载：打开下载的文件所在的地方（Mac 是「下载」文件夹），回 true。
//   perceive      感知整页（第 3 批「问这一页 → 操作整页」）：页面结构、带编号的可点 / 可填元素，回 PagePerception
//                 （page-operate.ts）。「问这一页」开着时带进引用片；编号留在网页标签里，Mac 的 tab_act 按它操作。
// 阅读模式、存进笔记用已有的 snapshot（可见正文），历史记录在网页侧记，都不要新的原生接口。
//
// 原生 → 网页：网页标签里按 ⌘F / ⌘P / ⌘Y 时键盘在原生网页里，主网页收不到；原生的菜单项调
// window.__plasticineWebMenu(WebMenuCommand) 交给网页界面（打开查找条、打印、历史记录）。

import { Type, type Static } from 'typebox';
import { NOTE_IMAGE_MAX_BYTES } from './notes-workspace.ts';

const STRICT = { additionalProperties: false };

export const WEB_PAGE_TOOLS = [
  'find', 'zoom', 'capture', 'capture_full', 'print', 'circle', 'thumbnail', 'downloads', 'perceive',
  'extract_marks', 'extract_images',
] as const;
export type WebPageToolName = (typeof WEB_PAGE_TOOLS)[number];

/** 缩放的上下限：和 Safari、Chrome 的档位两头一样（50%–300%）。 */
export const WEB_ZOOM_MIN = 0.5;
export const WEB_ZOOM_MAX = 3;
/** 查找框里最多打这么多字：再长不是在找词。 */
export const WEB_FIND_MAX_CHARS = 500;
/** 圈的一块最多带这么多字进引用片：对话一次引用合计 12 万字，圈一块是一小段，留够别的引用。 */
export const WEB_CIRCLE_TEXT_MAX_CHARS = 20_000;
/** 截图最大字节：存进笔记走笔记图片的上限（10 MB），给 Plasticine 走对话附件，两边都装得下。 */
export const WEB_IMAGE_MAX_BYTES = NOTE_IMAGE_MAX_BYTES;
/** 悬停预览卡 280 宽，缩略图按两倍像素截。 */
export const WEB_THUMBNAIL_WIDTH = 560;

export const WebExtractMarkSchema = Type.Object({ quote: Type.String({ minLength: 1, maxLength: 1000 }),
  context: Type.String({ maxLength: 60_000 }) }, STRICT);
export const WebExtractToolSchema = Type.Union([
  Type.Object({ kind: Type.Literal('extract_marks'), points: Type.Array(WebExtractMarkSchema, { maxItems: 12 }),
    focus: Type.Optional(Type.Integer({ minimum: 0, maximum: 11 })),
    color: Type.Optional(Type.String({ maxLength: 150 })) }, STRICT),
  Type.Object({ kind: Type.Literal('extract_images') }, STRICT),
]);
export const WebPageToolSchema = Type.Union([
  WebExtractToolSchema,
  Type.Object({ kind: Type.Literal('find'), query: Type.String({ minLength: 1, maxLength: WEB_FIND_MAX_CHARS }),
    backwards: Type.Boolean() }, STRICT),
  Type.Object({ kind: Type.Literal('find_clear') }, STRICT),
  Type.Object({ kind: Type.Literal('zoom'), factor: Type.Number({ minimum: WEB_ZOOM_MIN, maximum: WEB_ZOOM_MAX }) },
    STRICT),
  Type.Object({ kind: Type.Literal('capture'), scope: Type.Union([Type.Literal('visible'), Type.Literal('full')]) },
    STRICT),
  Type.Object({ kind: Type.Literal('print') }, STRICT),
  Type.Object({ kind: Type.Literal('circle') }, STRICT),
  Type.Object({ kind: Type.Literal('circle_cancel') }, STRICT),
  Type.Object({ kind: Type.Literal('thumbnail') }, STRICT),
  Type.Object({ kind: Type.Literal('downloads') }, STRICT),
  Type.Object({ kind: Type.Literal('perceive') }, STRICT),
]);
export type WebPageTool = Static<typeof WebPageToolSchema>;

export const WebFindResultSchema = Type.Object({ found: Type.Boolean() }, STRICT);
export type WebFindResult = Static<typeof WebFindResultSchema>;

export const WebPageImageSchema = Type.Object({
  type: Type.Union([Type.Literal('image/png'), Type.Literal('image/jpeg')]),
  base64: Type.String({ minLength: 1, maxLength: Math.ceil(WEB_IMAGE_MAX_BYTES / 3) * 4 }),
}, STRICT);
export type WebPageImage = Static<typeof WebPageImageSchema>;

/** 圈的一块：框里（或点的那个元素里）的文字，加上这一页的地址和标题。 */
export const WebCircleResultSchema = Type.Object({
  text: Type.String({ maxLength: WEB_CIRCLE_TEXT_MAX_CHARS }),
  url: Type.String({ maxLength: 4_096 }),
  title: Type.String({ maxLength: 1_000 }),
}, STRICT);
export type WebCircleResult = Static<typeof WebCircleResultSchema>;

export const WEB_MENU_COMMANDS = ['find', 'print', 'history'] as const;
export type WebMenuCommand = (typeof WEB_MENU_COMMANDS)[number];
