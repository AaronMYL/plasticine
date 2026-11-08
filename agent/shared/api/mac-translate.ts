// 沉浸式翻译的桥（Mac 0.4.0，第 2 批）：网页标签里注入的脚本（client/src/mac/translate-page.ts，跑在独立脚本世界里）
// 切段、排队、插译文；段落经原生层交给网页界面，网页界面调 POST /v2/translate，译文再经原生层送回脚本。设备不调模型，
// 只执行写明参数的动作（第 102 条「手只执行写明参数的动作」）。Swift 侧按这里的形状收发
// （mac/Sources/Plasticine/web-translate-protocol.swift）。
//
// 网页 → 原生：window.plasticineMac.translate（0.4.0 起才有，消息通道 `plasticineTranslate`，只收本站主 frame）
//   configure(tabId, TranslatePageConfig | null)   开 / 关 / 换显示方式 / 重试。run 换了就是重新开（关掉还原后重切，
//                                                  脚本记得的译文先插回，缺的才再要）；同一个 run 再配置一次就地刷新：
//                                                  按 display 切换，没译成的段落重新排队（网页界面的「重试」就是它）。
//                                                  null = 关掉，全部还原。
//                                                  原生层记住每个标签想要的状态：页面换了文档，脚本报 ready 后自动接着开。
//   deliver(tabId, TranslateDelivery)              一批译文（或没译成的段落及原因）。
// 原生 → 网页：window.__plasticineTranslateEvent(TranslateEvent)（进来先校验）。
//   page      新文档载入、网址变了：这一页能不能翻（付款类页面关死，和设备三条道同一套判法，在设备上判）。
//   request   脚本要译的一批段落（视口里的先送，priority 写明），fresh 是悬停工具条上的「重译」。
//   progress  这一轮还在等的（含排着没发出去的）/ 译好的 / 没译成的段数、送出去的字数，首屏全部回来时带一次首屏毫秒数。
//   ask       悬停工具条上的「问这一段」：原文和译文，网页界面把它作为引用放进对话框。

import { Type, type Static } from 'typebox';
import { TranslateDisplaySchema, TranslateTargetSchema, TRANSLATE_ITEM_MAX_CHARS } from './translate.ts';

const STRICT = { additionalProperties: false };
const TabId = Type.String({ minLength: 1, maxLength: 100 });
const RunId = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' });
const SegmentId = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_:.-]+$' });
// 一次送回脚本的译文最多这么多段：和服务端一批的上限同档，再多分几次送。
export const TRANSLATE_DELIVERY_MAX = 48;
// 「问这一段」带上的原文和译文各自的上限：一段正文不会更长，更长的截断。
export const TRANSLATE_ASK_MAX_CHARS = 8_000;

export const TranslatePageConfigSchema = Type.Object({
  run: RunId,
  target: TranslateTargetSchema,
  display: TranslateDisplaySchema,
}, STRICT);
export type TranslatePageConfig = Static<typeof TranslatePageConfigSchema>;

export const TranslateDeliverySchema = Type.Object({
  run: RunId,
  items: Type.Array(Type.Object({ id: SegmentId, text: Type.String() }, STRICT), { maxItems: TRANSLATE_DELIVERY_MAX }),
  failed: Type.Array(SegmentId, { maxItems: TRANSLATE_DELIVERY_MAX }),
}, STRICT);
export type TranslateDelivery = Static<typeof TranslateDeliverySchema>;

const RequestItem = Type.Object({
  id: SegmentId,
  text: Type.String({ minLength: 1, maxLength: TRANSLATE_ITEM_MAX_CHARS }),
}, STRICT);

// 脚本经原生层报给网页的四种消息（原生层补上 tabId 再转给网页）。
const PAGE = { type: Type.Literal('page'), url: Type.String(), blocked: Type.Boolean() };
const REQUEST = {
  type: Type.Literal('request'),
  run: RunId,
  url: Type.String(),
  priority: Type.Union([Type.Literal('visible'), Type.Literal('ahead')]),
  fresh: Type.Boolean(),
  items: Type.Array(RequestItem, { minItems: 1, maxItems: TRANSLATE_DELIVERY_MAX }),
};
const PROGRESS = {
  type: Type.Literal('progress'),
  run: RunId,
  pending: Type.Integer({ minimum: 0 }),
  done: Type.Integer({ minimum: 0 }),
  failed: Type.Integer({ minimum: 0 }),
  chars: Type.Integer({ minimum: 0 }),
  firstScreenMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
};
const ASK = {
  type: Type.Literal('ask'),
  url: Type.String(),
  title: Type.String(),
  source: Type.String({ maxLength: TRANSLATE_ASK_MAX_CHARS }),
  translation: Type.String({ maxLength: TRANSLATE_ASK_MAX_CHARS }),
};

export const TranslatePageMessageSchema = Type.Union([
  Type.Object(PAGE, STRICT), Type.Object(REQUEST, STRICT), Type.Object(PROGRESS, STRICT), Type.Object(ASK, STRICT),
]);
export type TranslatePageMessage = Static<typeof TranslatePageMessageSchema>;

export const TranslateEventSchema = Type.Union([
  Type.Object({ ...PAGE, tabId: TabId }, STRICT),
  Type.Object({ ...REQUEST, tabId: TabId }, STRICT),
  Type.Object({ ...PROGRESS, tabId: TabId }, STRICT),
  Type.Object({ ...ASK, tabId: TabId }, STRICT),
]);
export type TranslateEvent = Static<typeof TranslateEventSchema>;

export interface PlasticineMacTranslate {
  configure(tabId: string, config: TranslatePageConfig | null): void;
  deliver(tabId: string, delivery: TranslateDelivery): void;
}
