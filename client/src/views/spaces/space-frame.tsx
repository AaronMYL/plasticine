// 一页空间网页（第 8 批第 6 条）：沙盒 iframe（只给 allow-scripts，不给同源）+ srcdoc。页面在 iframe 里自己滚（右侧
// 目录要贴着、跟着滚动高亮）；缩略图是同一份网页按 1200 宽渲染再缩小，不能点。
// 和 iframe 说话走 postMessage（只认这个 iframe 发来的）：它准备好了要字体和插图，外面读好按字节传进去；深浅色变了传
// 新令牌；✎ 改字时让它进入可编辑，它交回「第几段改成了什么」，外面在没跑过脚本的原样上换好整页再交给 onEdit 去存；
// 链接交给外面开（站外的在网页标签，站内的走路由）。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Value } from 'typebox/value';
import { useApi } from '../../api/context.tsx';
import { SPACE_LINK_KINDS, SpaceQuoteAnchorSchema, type SpaceGenre, type SpaceLink } from '../../api/shared.ts';
import { QuoteAction } from '../../primitives/message/quote-action.tsx';
import { pushHash } from '../../shell/nav-history.ts';
import { openExternal } from '../../shell/open-external.ts';
import { routeHash } from '../../shell/routes.ts';
import { composeSpaceDocument } from './space-compose.ts';
import { applySpaceEdit, prepareSpace, type PreparedSpace } from './space-document.ts';
import { spaceFontFaces } from './space-fonts.ts';
import { linkRoute } from './space-links.ts';
import type { SpaceFrameMode } from './space-runtime.ts';
import { useSpaceTheme } from './space-theme.ts';
import type { SpaceQuoteAnchor } from './space-quote.ts';
import '../../primitives/message/quote-selection.css';

export const SPACE_SANDBOX = 'allow-scripts';

export interface FramedSpace {
  html: string;
  genre: SpaceGenre;
  title: string;
  /** 来信的日期（「2026 年 11 月 9 日」）。 */
  dateLabel: string;
}

export interface SpaceFrameProps {
  space: FramedSpace;
  mode: SpaceFrameMode;
  /** 读屏名字。 */
  label: string;
  editing?: boolean;
  /** 改了一段：整页片段（不带编号），交去存一版。 */
  onEdit?: (html: string) => void;
  /** 在页面里按了 Esc（改字时）。 */
  onEscape?: () => void;
  className?: string;
  onQuote?: (anchor: SpaceQuoteAnchor) => void;
  highlightParagraph?: number | undefined;
}

function isLinkKind(kind: string): kind is SpaceLink['kind'] {
  return (SPACE_LINK_KINDS as readonly string[]).includes(kind);
}

function messageOf(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null && Reflect.get(data, 'pz') === 'space'
    ? data as Record<string, unknown> : null;
}

/** 把 iframe 里按的快捷键（⌘K 这类）照样发给外面。 */
function replayKey(message: Record<string, unknown>): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: String(message['key']), metaKey: message['meta'] === true,
    ctrlKey: message['ctrl'] === true, shiftKey: message['shift'] === true, altKey: message['alt'] === true,
    bubbles: true, cancelable: true }));
}

export function SpaceFrame({ space, mode, label, editing = false, onEdit, onEscape, className, onQuote,
  highlightParagraph }: SpaceFrameProps)
  : ReactNode {
  const api = useApi();
  const frame = useRef<HTMLIFrameElement>(null);
  const [selection, setSelection] = useState<{ anchor: SpaceQuoteAnchor; left: number; top: number } | null>(null);
  const theme = useSpaceTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // iframe 里现在显示的正文：自己刚改的那一版存回来时它已经在页面上了，不重载（不然改字改到一半页面会跳回顶上）。
  // 只在传进来的正文变了时比：变成的正是页面上显示的，就只记下；别的（Plasticine 改了、撤销了）才换掉重画。
  const displayed = useRef(space.html);
  const lastProp = useRef(space.html);
  const source = useRef(space);
  const current = source.current;
  const metaChanged = space.title !== current.title || space.genre !== current.genre
    || space.dateLabel !== current.dateLabel;
  if (space.html !== lastProp.current || metaChanged) {
    lastProp.current = space.html;
    if (space.html !== displayed.current || metaChanged) {
      source.current = space;
      displayed.current = space.html;
    }
  }
  const { html, genre, title, dateLabel } = source.current;
  const prepared = useMemo<PreparedSpace>(() => prepareSpace({ html, genre, title, dateLabel }),
    [html, genre, title, dateLabel]);
  const srcDoc = useMemo(() => composeSpaceDocument({ body: prepared.body, genre, mode,
    tokens: themeRef.current.tokens, dark: themeRef.current.dark }), [prepared, genre, mode]);
  const handlers = useRef({ onEdit, onEscape, editing, onQuote, highlightParagraph });
  handlers.current = { onEdit, onEscape, editing, onQuote, highlightParagraph };

  useEffect(() => {
    const close = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('.quote-action') !== null) return;
      setSelection(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
    };
  }, []);

  useEffect(() => {
    setSelection(null);
  }, [editing, prepared]);

  useEffect(() => {
    if (highlightParagraph === undefined) return;
    frame.current?.contentWindow?.postMessage({ pz: 'space', type: 'highlight', paragraph: highlightParagraph }, '*');
  }, [highlightParagraph]);

  useEffect(() => {
    const controller = new AbortController();
    const post = (message: Record<string, unknown>, transfer: Transferable[] = []): void => {
      frame.current?.contentWindow?.postMessage({ pz: 'space', ...message }, '*', transfer);
    };
    // 准备好了可能说两遍（自己载完说一遍，外面打招呼又说一遍）：只接第一遍。
    let served = false;
    const ready = (message: Record<string, unknown>): void => {
      if (served) return;
      served = true;
      post({ type: 'theme', vars: themeRef.current.tokens, dark: themeRef.current.dark });
      if (mode === 'page' && handlers.current.editing) post({ type: 'edit', on: true });
      if (handlers.current.highlightParagraph !== undefined) {
        post({ type: 'highlight', paragraph: handlers.current.highlightParagraph });
      }
      void spaceFontFaces(String(message['wenkai'] ?? '')).then((faces) => {
        if (!controller.signal.aborted) post({ type: 'fonts', faces });
      });
      const assets = Array.isArray(message['assets']) ? message['assets'].map(String) : [];
      for (const src of assets) {
        void api.spaces.asset(src, controller.signal).then(async (blob) => {
          const data = await blob.arrayBuffer();
          if (!controller.signal.aborted) post({ type: 'asset', src, data, mime: blob.type }, [data]);
        }, (cause: unknown) => console.warn('插图没读到，这一页先不显示', cause));
      }
    };
    const listen = (event: MessageEvent): void => {
      if (event.source === null || event.source !== frame.current?.contentWindow) return;
      const message = messageOf(event.data);
      if (message === null) return;
      if (message['type'] === 'ready') ready(message);
      if (mode === 'thumb') return;
      if (message['type'] === 'open') {
        openExternal(String(message['url']), String(message['title'] ?? ''));
      } else if (message['type'] === 'navigate') {
        pushHash(String(message['hash']));
      } else if (message['type'] === 'link') {
        const kind = String(message['kind']);
        if (isLinkKind(kind)) pushHash(routeHash(linkRoute({ kind, id: String(message['id']) })));
      } else if (message['type'] === 'edited') {
        const html = applySpaceEdit(prepared, Number(message['index']), String(message['html']));
        displayed.current = html;
        handlers.current.onEdit?.(html);
      } else if (message['type'] === 'escape') {
        handlers.current.onEscape?.();
      } else if (message['type'] === 'key') {
        replayKey(message);
      } else if (message['type'] === 'selection') {
        const anchor = { text: message['text'], sectionId: message['sectionId'], paragraph: message['paragraph'] };
        const rect = frame.current?.getBoundingClientRect();
        if (rect === undefined || handlers.current.onQuote === undefined
          || !Value.Check(SpaceQuoteAnchorSchema, anchor)) {
          setSelection(null);
        } else {
          const x = Number(message['left']);
          const y = Number(message['top']);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          setSelection({ anchor, left: Math.max(8, Math.min(rect.left + x, innerWidth - 150)),
            top: Math.max(8, Math.min(rect.top + y - 40, innerHeight - 48)) });
        }
      }
    };
    window.addEventListener('message', listen);
    // 页面可能在挂上监听之前就载完了、话已经说过：打个招呼让它再说一遍。
    post({ type: 'hello' });
    return () => {
      controller.abort();
      window.removeEventListener('message', listen);
    };
  }, [api, mode, prepared]);

  useEffect(() => {
    const message = { pz: 'space', type: 'theme', vars: theme.tokens, dark: theme.dark };
    frame.current?.contentWindow?.postMessage(message, '*');
  }, [theme]);

  useEffect(() => {
    if (mode === 'page') {
      frame.current?.contentWindow?.postMessage({ pz: 'space', type: 'edit', on: editing }, '*');
      if (editing) frame.current?.focus();
    }
  }, [editing, mode, srcDoc]);

  return (
    <><iframe ref={frame} className={className} title={label} sandbox={SPACE_SANDBOX} srcDoc={srcDoc}
      onLoad={() => frame.current?.contentWindow?.postMessage({ pz: 'space', type: 'hello' }, '*')}
      referrerPolicy="no-referrer" {...(mode === 'thumb' ? { tabIndex: -1, 'aria-hidden': true } : {})} />
      {createPortal(<QuoteAction fixed position={onQuote === undefined ? null : selection}
          onQuote={() => {
            if (selection === null || onQuote === undefined) return;
            onQuote(selection.anchor);
            setSelection(null);
            frame.current?.contentWindow?.postMessage({ pz: 'space', type: 'clear-selection' }, '*');
          }} />, document.body)}
    </>
  );
}
