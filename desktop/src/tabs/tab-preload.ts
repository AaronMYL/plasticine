// 每个网页标签的 preload（独立脚本世界，sandbox；构建时打成一个文件）。页面自己的脚本看不到这里，也拿不到消息通道。
// 主进程经 tab:call 叫这里做事（翻译、圈一块、问这一页、DOM 动作），这里经 tab:reply 回；翻译脚本自己发的消息走
// tab:translate。用户在标签里按下鼠标报 tab:pointer（界面收起非模态浮层）。

import { extractPage, type ExtractPageCommand } from '../../../client/src/mac/extract-page.ts';
import { contextBridge, ipcRenderer } from 'electron';
import { circlePage, pageOperate } from 'plasticine:page-scripts';
import type { TranslateDelivery, TranslatePageConfig } from '../../../agent/shared/api/mac-translate.ts';
import { WEB_PAGE_TEXT_MAX_CHARS } from '../../../agent/shared/api/mac-bridge.ts';
import { browserHost } from '../../../client/src/mac/translate-page-host.ts';
import { installPageTranslator, type PageTranslator } from '../../../client/src/mac/translate-page.ts';
import { TAB_CHANNELS } from '../app/channels.ts';
import { DIALOG_ARM_EVENT, DIALOG_SEEN_EVENT, dialogGuard, type SeenDialog } from './tab-dialogs.ts';
import { clickMarked, fillMarked, focusedFacts, focusIsButton, hasText, locate, markedCenter, pageState, pasteInto,
  readPage, scrollPosition, viewportSize, visibleText } from './tab-dom.ts';

interface Call {
  id: string;
  op: string;
  args: Record<string, unknown>;
}

let translator: PageTranslator | null = null;

function translatorOf(): PageTranslator {
  translator ??= installPageTranslator(browserHost((message) => ipcRenderer.send(TAB_CHANNELS.translate, message)));
  return translator;
}

declare global {
  interface Window {
    __plasticineCircleCancel?: () => void;
  }
}

async function run(call: Call): Promise<unknown> {
  const args = call.args;
  switch (call.op) {
    case 'extract':
      return extractPage(document, args.command as ExtractPageCommand);
    case 'snapshot':
      return visibleText(document, WEB_PAGE_TEXT_MAX_CHARS);
    case 'read':
      return readPage(document, Number(args.offset ?? 0));
    case 'locate':
      return locate(document, typeof args.selector === 'string' ? args.selector : null,
        typeof args.text === 'string' ? args.text : null, String(args.nonce));
    case 'state':
      return pageState(document, String(args.nonce), args.cleanup === true);
    case 'click':
      return clickMarked(document, String(args.nonce));
    case 'center':
      return markedCenter(document, String(args.nonce));
    case 'fill':
      return fillMarked(document, String(args.nonce), String(args.value ?? ''));
    case 'viewport':
      return viewportSize(window);
    case 'focused':
      return focusedFacts(document);
    case 'contains':
      return hasText(document, String(args.text ?? ''));
    case 'scrolled':
      return scrollPosition(document, Number(args.x ?? 0), Number(args.y ?? 0));
    case 'focus-button':
      return focusIsButton(document);
    case 'paste':
      return pasteInto(document, String(args.text ?? ''), typeof args.html === 'string' ? args.html : null);
    case 'operate':
      return JSON.parse(await pageOperate(args.request)) as unknown;
    case 'circle': {
      const result = await circlePage();
      return result === null ? null : JSON.parse(result) as unknown;
    }
    case 'circle.cancel':
      window.__plasticineCircleCancel?.();
      return true;
    case 'translate.start':
      return translatorOf().start(args.config as TranslatePageConfig);
    case 'translate.stop':
      translator?.stop();
      return true;
    case 'translate.apply':
      translatorOf().apply(args.delivery as TranslateDelivery);
      return true;
    case 'dialog-arm':
      window.dispatchEvent(new CustomEvent(DIALOG_ARM_EVENT, { detail: JSON.stringify({ accept: args.accept === true,
        text: typeof args.text === 'string' ? args.text : null }) }));
      return { armed: guarded, last: lastDialog };
    default:
      throw new Error(`网页标签不会 ${call.op}。`);
  }
}

ipcRenderer.on(TAB_CHANNELS.call, (_event, call: Call) => {
  run(call).then(
    (value) => ipcRenderer.send(TAB_CHANNELS.reply, { id: call.id, ok: true, value }),
    (error: unknown) => ipcRenderer.send(TAB_CHANNELS.reply, { id: call.id, ok: false,
      error: error instanceof Error ? error.message : String(error) }),
  );
});

// 后台标签的弹框不弹到他眼前（tab-dialogs.ts）：页面脚本跑之前装好；弹过的记下来。
let lastDialog: SeenDialog | null = null;
let guarded = true;
try {
  contextBridge.executeInMainWorld({ func: dialogGuard });
} catch (error) {
  // 装不上（特殊页面）就照常弹；tab_dialog 回执里说清楚没装上。
  guarded = error instanceof Error ? false : guarded;
}
window.addEventListener(DIALOG_SEEN_EVENT, (event) => {
  const detail = (event as CustomEvent<unknown>).detail;
  lastDialog = typeof detail === 'string' ? JSON.parse(detail) as SeenDialog : lastDialog;
});

// 每个文档载入就装上翻译脚本（和 Mac 壳一样）：它先报一次 page，壳按想要的状态接着开。
window.addEventListener('DOMContentLoaded', () => {
  translatorOf();
}, { once: true });

window.addEventListener('pointerdown', (event) => {
  if (event.isTrusted) {
    ipcRenderer.send(TAB_CHANNELS.pointer);
  }
}, { capture: true, passive: true });
