// 预测消息（11-13 Aaron 定，设计稿「预测消息 · 设计稿」）：对话和消息输入框里的浅色字。
// - 输入框空着、轮到他说：给一整句；打了字：停手 PAUSE_MS 才猜，只补光标后面的，不改他打的字。
// - 光标不在末尾、选中了一段、没聚焦、输入法在组词：不出也不猜；组完词按一次新输入算。
// - 接着打的字和浅色字对得上就顺着吃掉，对不上就撤下重猜。
// - Tab 或点浅色字：采纳，字进框里、光标到末尾，发送还是他自己按；Esc：这一条藏起来，下次打字再猜。没有建议时 Tab、
//   Esc 都照原来的用法（返回 false，调用方接着处理）。
// - 预测闭环：采纳报 kept；摆了 MIN_VISIBLE_MS 以上被盖掉、或 Esc，报 rejected；一闪而过的不报。
// 和笔记续写共用 predict-rules.ts 里的规则（停手时间、一闪而过不算、输入法组词判断）和同一种流式接口。

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useApi } from '../../api/context.tsx';
import type { ComposeTarget } from '../../api/shared.ts';
import { imeBusy, MIN_VISIBLE_MS, PREDICT_PAUSE_MS } from './predict-rules.ts';

export const PAUSE_MS = PREDICT_PAUSE_MS;

export interface ComposePredictOptions {
  /** 哪段对话；null = 不猜（开关关着、来信、@ 了对方的 Plasticine 等由调用方判断）。 */
  target: ComposeTarget | null;
  draft: string;
  input: RefObject<HTMLTextAreaElement | null>;
  /** 把采纳后的整段字放回去（和平时打字同一个出口）。 */
  change: (value: string) => void;
}

export interface ComposePrediction {
  /** 光标后的浅色字；没有是 null。 */
  ghost: string | null;
  accept: () => void;
  /** 键盘：Tab 采纳、Esc 藏起，处理了返回 true；没有建议或别的键返回 false。 */
  keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

interface Shown { base: string; text: string; loopId: string | undefined; at: number }

/** 光标在末尾、没选中、聚焦着、没在组词：这时才能出浅色字。 */
function caretAtEnd(input: HTMLTextAreaElement | null, draft: string): boolean {
  return input !== null && document.activeElement === input && input.selectionStart === draft.length
    && input.selectionEnd === draft.length;
}

export function useComposePredict({ target, draft, input, change }: ComposePredictOptions): ComposePrediction {
  const api = useApi();
  const [shown, setShown] = useState<Shown | null>(null);
  const [ready, setReady] = useState(0);
  const composing = useRef(false);
  /** Esc 藏起来以后，这一段草稿不再猜。 */
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

  // 草稿变了：对得上就吃掉，对不上就撤下；然后停手 PAUSE_MS 再猜（流式边到边画）。
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
        // 猜不出来不打扰他：不出浅色字，控制台留一句。
        if (!controller.signal.aborted) console.warn('输入建议这次没猜成', cause);
      });
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  // targetKey 代替 target（调用方每次渲染给的是新对象）；ready：聚焦、组完词时重来一次。
  }, [api, draft, targetKey, ready, input, drop]);

  // 聚焦、失焦、组词、光标挪动：失焦或光标离开末尾就撤下（不算没要）；回来再猜。
  useEffect(() => {
    const element = input.current;
    if (element === null) return undefined;
    const again = (): void => setReady((value) => value + 1);
    const away = (): void => { if (current.current.shown !== null) setShown(null); };
    const onSelect = (): void => {
      if (!caretAtEnd(element, current.current.draft)) away();
    };
    const start = (): void => { composing.current = true; away(); };
    const end = (): void => { composing.current = false; again(); };
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

  // 换了对话、关了开关：撤下，不算没要。
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
    // 字放进去以后光标到末尾；焦点本来就在框里（点浅色字时按下就拦住了失焦）。
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
