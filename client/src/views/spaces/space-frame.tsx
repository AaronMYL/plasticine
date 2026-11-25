import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Value } from 'typebox/value';
import { useApi } from '../../api/context.tsx';
import { SPACE_LINK_KINDS, SpaceQuoteAnchorSchema, type SpaceGenre, type SpaceLink } from '../../api/shared.ts';
import { QuoteAction } from '../../primitives/message/quote-action.tsx';
import { showImages, type ViewerImage } from '../../primitives/image-viewer/index.tsx';
import { pushHash } from '../../shell/nav-history.ts';
import { openExternal } from '../../shell/open-external.ts';
import { routeHash } from '../../shell/routes.ts';
import { composeSpaceDocument } from './space-compose.ts';
import { applySpaceEdit, prepareSpace, type LetterSigner, type PreparedSpace } from './space-document.ts';
import { spaceFontFaces } from './space-fonts.ts';
import { linkRoute } from './space-links.ts';
import type { SpaceFrameMode } from './space-runtime.ts';
import { bookSpacePosition, type BookSpacePosition } from './book-link.ts';
import { useSpaceTheme } from './space-theme.ts';
import type { SpaceQuoteAnchor } from './space-quote.ts';
import '../../primitives/message/quote-selection.css';
import { useCloseOnContextMenu } from '../../shell/use-context-menu-close.ts';
import { plasticineMarkSvg } from '../../shell/plasticine-mark.tsx';
import { useBotEngine } from '../mates/bot/bot-engine.ts';
import { stillSvg } from '../mates/bot/bot-render.ts';
import { useMainName, useMainVariant } from '../mates/main-store.ts';

const SIGN_MARK_SIZE = 34;

function useLetterSigner(): LetterSigner {
  const name = useMainName();
  const variant = useMainVariant();
  const engine = useBotEngine();
  return useMemo(() => ({ name, mark: engine === null ? plasticineMarkSvg(SIGN_MARK_SIZE)
    : stillSvg(engine, { kind: 'main', variant }, 'idle', SIGN_MARK_SIZE) }), [name, variant, engine]);
}

export const SPACE_SANDBOX = 'allow-scripts';

export interface FramedSpace {
  html: string;
  genre: SpaceGenre;
  title: string;
  dateLabel: string;
}

export interface SpaceFrameProps {
  space: FramedSpace;
  mode: SpaceFrameMode;
  label: string;
  editing?: boolean;
  bookPosition?: Pick<BookSpacePosition, 'bookId' | 'chapter'>;
  onBookJump?: (position: BookSpacePosition) => void;
  onEdit?: (html: string) => void;
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

function replayKey(message: Record<string, unknown>): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: String(message['key']), metaKey: message['meta'] === true,
    ctrlKey: message['ctrl'] === true, shiftKey: message['shift'] === true, altKey: message['alt'] === true,
    bubbles: true, cancelable: true }));
}

export function SpaceFrame({ space, mode, label, editing = false, onEdit, onEscape, className, onQuote,
  highlightParagraph, bookPosition, onBookJump }: SpaceFrameProps)
  : ReactNode {
  const api = useApi();
  const frame = useRef<HTMLIFrameElement>(null);
  const [selection, setSelection] = useState<{ anchor: SpaceQuoteAnchor; left: number; top: number } | null>(null);
  useCloseOnContextMenu(() => setSelection(null));
  const theme = useSpaceTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
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
  const signer = useLetterSigner();
  const prepared = useMemo<PreparedSpace>(() => prepareSpace({ html, genre, title, dateLabel, signer }),
    [html, genre, title, dateLabel, signer]);
  const srcDoc = useMemo(() => composeSpaceDocument({ body: prepared.body, genre, mode,
    tokens: themeRef.current.tokens, dark: themeRef.current.dark }), [prepared, genre, mode]);
  const handlers = useRef({ onEdit, onEscape, editing, onQuote, highlightParagraph, onBookJump, bookPosition });
  handlers.current = { onEdit, onEscape, editing, onQuote, highlightParagraph, onBookJump, bookPosition };

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

  useLayoutEffect(() => {
    const controller = new AbortController();
    const post = (message: Record<string, unknown>, transfer: Transferable[] = []): void => {
      frame.current?.contentWindow?.postMessage({ pz: 'space', ...message }, '*', transfer);
    };
    const blobs = new Map<string, Blob>();
    const urls: string[] = [];
    const openImages = (message: Record<string, unknown>): void => {
      const list = Array.isArray(message['images']) ? message['images'] as unknown[] : [];
      const clicked = Number(message['index']);
      const shown: { image: ViewerImage; at: number }[] = [];
      list.forEach((entry, at) => {
        if (typeof entry !== 'object' || entry === null) return;
        const asset = String(Reflect.get(entry, 'asset') ?? '');
        const data = String(Reflect.get(entry, 'data') ?? '');
        const alt = String(Reflect.get(entry, 'alt') ?? '');
        const blob = blobs.get(asset);
        let src: string | null = null;
        if (blob !== undefined) {
          src = URL.createObjectURL(blob);
          urls.push(src);
        } else if (data.startsWith('data:image/')) src = data;
        if (src !== null) shown.push({ image: { src, alt, caption: alt === '' ? undefined : alt }, at });
      });
      const start = shown.findIndex((item) => item.at === clicked);
      if (start >= 0) showImages(shown.map((item) => item.image), start);
    };
    let served = false;
    const ready = (message: Record<string, unknown>): void => {
      if (served) return;
      served = true;
      post({ type: 'theme', vars: themeRef.current.tokens, dark: themeRef.current.dark });
      if (handlers.current.bookPosition !== undefined) {
        post({ type: 'book-position', ...handlers.current.bookPosition });
      }
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
          blobs.set(src, blob);
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
      if (message['type'] === 'image') {
        openImages(message);
      } else if (message['type'] === 'open') {
        openExternal(String(message['url']), String(message['title'] ?? ''));
      } else if (message['type'] === 'navigate') {
        pushHash(String(message['hash']));
      } else if (message['type'] === 'link') {
        const kind = String(message['kind']);
        if (kind === 'book') {
          const position = bookSpacePosition(String(message['id']));
          if (position !== null) {
            if (handlers.current.onBookJump !== undefined) handlers.current.onBookJump(position);
            else pushHash(routeHash({ view: 'books', noteId: null, bookId: position.bookId,
              bookPosition: { chapter: position.chapter, offset: position.offset } }));
          }
        } else if (isLinkKind(kind)) pushHash(routeHash(linkRoute({ kind, id: String(message['id']) })));
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
    post({ type: 'hello' });
    return () => {
      controller.abort();
      window.removeEventListener('message', listen);
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [api, mode, prepared]);

  useEffect(() => {
    if (bookPosition !== undefined) {
      frame.current?.contentWindow?.postMessage({ pz: 'space', type: 'book-position', ...bookPosition }, '*');
    }
  }, [bookPosition?.bookId, bookPosition?.chapter, srcDoc]);

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
