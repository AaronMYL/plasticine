import { currentComposer } from '../views/conversation/current-composer.ts';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useApi } from '../api/context.tsx';
import type { PlasticineMacTranslate } from '../api/shared.ts';
import { useClientState } from '../state/context.tsx';
import { useTelemetry } from '../telemetry.ts';
import { WebTranslator } from './web-translate.ts';
import { hostTranslate } from './host.ts';

declare global {
  interface Window {
    __plasticineTranslateEvent?: (event: unknown) => void;
  }
}

export const TRANSLATE_SETTINGS_CHANGED = 'plasticine:translate-settings-changed';

export const WebTranslatorContext = createContext<WebTranslator | null>(null);

export function useWebTranslator(): WebTranslator | null {
  return useContext(WebTranslatorContext);
}

export function nativeTranslate(): PlasticineMacTranslate | null {
  return hostTranslate();
}

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
  const targetState = useClientState();
  const translator = useMemo(() => (bridge === null ? null : new WebTranslator({
    api: api.translate,
    bridge,
    telemetry,
    ask: (quote) => {
      const source = Array.from(quote.source).slice(0, 40).join('');
      currentComposer(targetState).ui.addQuote({ id: `quote_paragraph_${quote.url}#${source}`, kind: 'object',
        sourceId: quote.url,
        label: `「${quote.title === '' ? quote.url : quote.title}」的一段`, text: paragraphQuoteText(quote) });
      window.__plasticineFocusComposer?.();
    },
  })), [api, bridge, telemetry, targetState]);
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
