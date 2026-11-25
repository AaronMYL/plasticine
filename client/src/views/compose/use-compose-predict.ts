import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useApi } from '../../api/context.tsx';
import type { ComposeTarget } from '../../api/shared.ts';
import { imeBusy, MIN_VISIBLE_MS, PREDICT_PAUSE_MS } from './predict-rules.ts';

export const PAUSE_MS = PREDICT_PAUSE_MS;

export interface ComposePredictOptions {
  target: ComposeTarget | null;
  draft: string;
  input: RefObject<HTMLTextAreaElement | null>;
  change: (value: string) => void;
}

export interface ComposePrediction {
  ghost: string | null;
  accept: () => void;
  keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

interface Shown { base: string; text: string; loopId: string | undefined; at: number }

function caretAtEnd(input: HTMLTextAreaElement | null, draft: string): boolean {
  return input !== null && document.activeElement === input && input.selectionStart === draft.length
    && input.selectionEnd === draft.length;
}

export function useComposePredict({ target, draft, input, change }: ComposePredictOptions): ComposePrediction {
  const api = useApi();
  const [shown, setShown] = useState<Shown | null>(null);
  const [ready, setReady] = useState(0);
  const composing = useRef(false);
  const hiddenFor = useRef<string | null>(null);
  const targetKey = target === null ? null : `${target.kind}:${target.id}`;
  const current = useRef({ shown, target, draft });
  current.current = { shown, target, draft };

  const report = useCallback((loopId: string | undefined, outcome: 'kept' | 'rejected') => {
    if (loopId === undefined) return;
    void api.compose.outcome({ loopId, outcome })
      .catch((cause: unknown) => console.warn('输入建议的结果没报上，这一条不算', cause));
  }, [api]);

  const drop = useCallback((reason: 'typed' | 'escape' | 'gone') => {
    const previous = current.current.shown;
    if (previous === null) return;
    if (reason === 'escape' || (reason === 'typed' && Date.now() - previous.at >= MIN_VISIBLE_MS)) {
      report(previous.loopId, 'rejected');
    }
    setShown(null);
  }, [report]);

  useEffect(() => {
    const previous = current.current.shown;
    if (previous !== null && draft.startsWith(previous.base)) {
      const typed = draft.slice(previous.base.length);
      if (typed === '') return undefined;
      if (previous.text.startsWith(typed) && previous.text.length > typed.length) {
        setShown({ ...previous, base: draft, text: previous.text.slice(typed.length) });
        return undefined;
      }
    }
    if (previous !== null && previous.base !== draft) drop('typed');
    if (hiddenFor.current !== null && hiddenFor.current !== draft) hiddenFor.current = null;
    const target = current.current.target;
    if (target === null || composing.current || hiddenFor.current === draft) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!caretAtEnd(input.current, draft) || composing.current) return;
      const base = draft;
      let text = '';
      const live = (): boolean => !controller.signal.aborted && current.current.draft === base;
      void api.compose.predict(target, base, (delta) => {
        text += delta;
        if (live()) setShown({ base, text, loopId: undefined, at: Date.now() });
      }, controller.signal).then((view) => {
        if (!live()) return;
        setShown(view.text === '' ? null : { base, text: view.text, loopId: view.loopId, at: Date.now() });
      }, (cause: unknown) => {
        if (!controller.signal.aborted) console.warn('输入建议这次没猜成', cause);
      });
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, draft, targetKey, ready, input, drop]);

  useEffect(() => {
    const element = input.current;
    if (element === null) return undefined;
    const again = (): void => setReady((value) => value + 1);
    const away = (): void => { if (current.current.shown !== null) setShown(null); };
    const onSelect = (): void => {
      if (!caretAtEnd(element, current.current.draft)) away();
    };
    const start = (): void => {
      composing.current = true;
      away();
    };
    const end = (): void => {
      composing.current = false;
      again();
    };
    element.addEventListener('focus', again);
    element.addEventListener('blur', away);
    element.addEventListener('select', onSelect);
    element.addEventListener('click', onSelect);
    element.addEventListener('compositionstart', start);
    element.addEventListener('compositionend', end);
    return () => {
      element.removeEventListener('focus', again);
      element.removeEventListener('blur', away);
      element.removeEventListener('select', onSelect);
      element.removeEventListener('click', onSelect);
      element.removeEventListener('compositionstart', start);
      element.removeEventListener('compositionend', end);
    };
  }, [input]);

  useEffect(() => () => setShown(null), [targetKey]);

  const visible = shown !== null && shown.base === draft && shown.text !== '' && target !== null
    ? shown.text : null;

  const accept = useCallback(() => {
    const previous = current.current.shown;
    if (previous === null || previous.base !== current.current.draft) return;
    const value = previous.base + previous.text;
    report(previous.loopId, 'kept');
    setShown(null);
    change(value);
    requestAnimationFrame(() => {
      const element = input.current;
      if (element === null) return;
      element.focus({ preventScroll: true });
      element.setSelectionRange(value.length, value.length);
    });
  }, [change, input, report]);

  const keyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (visible === null || imeBusy(event.nativeEvent, composing.current)) return false;
    if (event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      accept();
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hiddenFor.current = current.current.draft;
      drop('escape');
      return true;
    }
    return false;
  }, [accept, drop, visible]);

  return { ghost: visible, accept, keyDown };
}
