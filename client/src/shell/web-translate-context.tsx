// 沉浸式翻译装到壳上（Mac 0.4.0，iPhone 0.2.0）：只有原生桥带 translate 时才有；网页版、手机浏览器、旧 App 里是 null，
// 网页工具条上就不出「文A」。原生层的事件经 window.__plasticineTranslateEvent 进来；设置页存了翻译设置会发
// TRANSLATE_SETTINGS_CHANGED，这里重新读一遍。

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useApi } from '../api/context.tsx';
import type { PlasticineMacTranslate } from '../api/shared.ts';
import { useClientState } from '../state/context.tsx';
import { useTelemetry } from '../telemetry.ts';
import { WebTranslator } from './web-translate.ts';
import { hostTranslate } from './host.ts';

declare global {
  interface Window {
    /** 原生层报翻译的事（agent/shared/api/mac-translate.ts 的 TranslateEvent，进来先校验）。 */
    __plasticineTranslateEvent?: (event: unknown) => void;
  }
}

/** 设置 · AI · 网页翻译存了之后发这个，壳上的翻译重新读设置和模型。 */
export const TRANSLATE_SETTINGS_CHANGED = 'plasticine:translate-settings-changed';

export const WebTranslatorContext = createContext<WebTranslator | null>(null);

export function useWebTranslator(): WebTranslator | null {
  return useContext(WebTranslatorContext);
}

/** Mac 0.4.0、iPhone 0.2.0 起才有的翻译桥（同一份协议）；没有就是 null。 */
export function nativeTranslate(): PlasticineMacTranslate | null {
  return hostTranslate();
}

/** 「问这一段」的引用片：网页标题、网址、原文和译文。 */
export function paragraphQuoteText(quote: { url: string; title: string; source: string; translation: string }): string {
  const title = quote.title === '' ? quote.url : quote.title;
  return `${title}\n${quote.url}\n\n原文：${quote.source}\n\n译文：${quote.translation}`;
}

export function WebTranslateProvider({ children, bridge = nativeTranslate() }: {
  children: ReactNode;
  bridge?: PlasticineMacTranslate | null;
}): ReactNode {
  const api = useApi();
  const telemetry = useTelemetry();
  const { conversationUi } = useClientState();
  const translator = useMemo(() => (bridge === null ? null : new WebTranslator({
    api: api.translate,
    bridge,
    telemetry,
    ask: (quote) => {
      const source = Array.from(quote.source).slice(0, 40).join('');
      conversationUi.addQuote({ id: `quote_paragraph_${quote.url}#${source}`, kind: 'object', sourceId: quote.url,
        label: `「${quote.title === '' ? quote.url : quote.title}」的一段`, text: paragraphQuoteText(quote) });
      window.__plasticineFocusComposer?.();
    },
  })), [api, bridge, telemetry, conversationUi]);
  useEffect(() => {
    if (translator === null) {
      return undefined;
    }
    const controller = new AbortController();
    const load = (): void => {
      translator.refresh(controller.signal).catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          console.warn('翻译设置没读到，「文A」先按默认设置翻', cause);
        }
      });
    };
    load();
    const receive = (event: unknown): void => translator.receive(event);
    window.__plasticineTranslateEvent = receive;
    window.addEventListener(TRANSLATE_SETTINGS_CHANGED, load);
    return () => {
      controller.abort();
      window.removeEventListener(TRANSLATE_SETTINGS_CHANGED, load);
      if (window.__plasticineTranslateEvent === receive) {
        delete window.__plasticineTranslateEvent;
      }
    };
  }, [translator]);
  return <WebTranslatorContext.Provider value={translator}>{children}</WebTranslatorContext.Provider>;
}
