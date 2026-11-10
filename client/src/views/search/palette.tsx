// ⌘K 全局切换（《优化清单》第 2 条，11-07 设计稿 Palette）：标签、书签、笔记、空间、项目、旁聊、对话、图书都能搜到，
// 用统一索引（/v2/search）加这台设备上的竖排标签、旁聊和书签；结果按组列（palette-results.ts），最后一组是「让 Plasticine 做」
// （这句话放进对话框的输入框）。↑↓ 选、↵ 打开、Esc 收起；弹出 / 收起是缩放淡入（减少动态效果时直接出现）。
// 电脑上浮在窗口上方居中（宽 640），手机上占满屏幕。

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { LineView, SearchResult } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { webBookmarks } from '../bookmarks/bookmark-address.ts';
import { spaceLook } from '../../shell/columns/library-column.tsx';
import { SiteIcon } from '../../shell/site-icon.tsx';
import { HueTile, type HueName } from '../../shell/hue.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { EASE_OUT, MOTION, play, playThen } from '../../shell/motion.ts';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { listTime } from '../contacts/contact-time.ts';
import {
  GROUP_LABELS,
  paletteItems,
  type PaletteGroup,
  type PaletteItem,
  type PaletteTarget,
} from './palette-results.ts';
import './palette.css';

/** 停打字这么久再查（输入法组合期间不查）。 */
const SEARCH_DELAY_MS = 150;
/** 一次要多少条（分组后每组只列几条）。 */
const SEARCH_LIMIT = 30;

const SCOPE_NOTE = '查标签、书签、队友与群组、空间、笔记、对话、记忆、信息流和图书；'
  + '已删除的内容和「不感兴趣」的信息流不查。';

const LEADS: Readonly<Record<Exclude<PaletteGroup, 'tab' | 'bookmark' | 'side' | 'ask'>,
  { icon: IconName; hue: HueName }>> = {
  space: { icon: 'space', hue: 'sky' },
  note: { icon: 'notes', hue: 'teal' },
  message: { icon: 'conversation', hue: 'slate' },
  memory: { icon: 'memory', hue: 'olive' },
  feed: { icon: 'feed', hue: 'sky' },
  book: { icon: 'books', hue: 'ochre' },
};

const ENTER: Keyframe[] = [
  { opacity: 0, transform: 'translateX(-50%) scale(0.97)' },
  { opacity: 1, transform: 'translateX(-50%) scale(1)' },
];
const PHONE_ENTER: Keyframe[] = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];

function Lead({ item, spaces }: { item: PaletteItem; spaces: ReadonlyMap<string, SpaceLook> }): ReactNode {
  const kind = item.lead.kind;
  if (kind === 'tab' || kind === 'bookmark') {
    return <SiteIcon url={item.lead.url ?? ''} title={item.title} tabId={item.lead.tabId} />;
  }
  const space = item.lead.spaceId === undefined ? undefined : spaces.get(item.lead.spaceId);
  if (space !== undefined) return <HueTile hue={space.hue} icon={space.icon} size={22} />;
  if (kind === 'side') return <span className="palette-mark"><PlasticineMark size={14} /></span>;
  if (kind === 'ask') return <span className="palette-plus"><Icon name="plus" size={13} /></span>;
  return <HueTile hue={LEADS[kind].hue} icon={LEADS[kind].icon} size={22} />;
}

type SpaceLook = ReturnType<typeof spaceLook>;

/** 空间按种类画图标（和资料库第二栏同一套 spaceLook）：打开 ⌘K 时读一次空间列表。 */
function useSpaceLooks(): ReadonlyMap<string, SpaceLook> {
  const api = useApi();
  const [looks, setLooks] = useState<ReadonlyMap<string, SpaceLook>>(new Map());
  useEffect(() => {
    const controller = new AbortController();
    api.spaces.list(controller.signal).then((result) => {
      setLooks(new Map(result.spaces.map((space) => [space.id, spaceLook(space)])));
    }, (cause: unknown) => {
      if (!controller.signal.aborted) console.warn('⌘K 没读到空间列表，空间照通用图标画', cause);
    });
    return () => controller.abort();
  }, [api]);
  return looks;
}

function useSearch(query: string, composing: boolean): { results: SearchResult[]; error: string | null } {
  const api = useApi();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q === '' || composing) {
      setResults([]);
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.search.query({ q, limit: SEARCH_LIMIT }, controller.signal).then((page) => {
        if (controller.signal.aborted) return;
        setResults(page.results);
        setError(null);
      }, (cause: unknown) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, query, composing]);
  return { results, error };
}

export interface PaletteProps {
  phone: boolean;
  onClose: () => void;
  onOpen: (target: PaletteTarget) => void;
}

export function Palette({ phone, onClose, onOpen }: PaletteProps): ReactNode {
  const live = useLive();
  const timeZone = useTimeZone();
  const { webTabs } = useClientState();
  const tabs = useStore(webTabs.store);
  const lines = useStore(live.lines.list);
  const bookmarks = webBookmarks(useStore(live.bookmarks.data).bookmarks);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { results, error } = useSearch(query, composing);
  const spaces = useSpaceLooks();
  const sides = useMemo(() => lines.lines.filter((line): line is LineView => line.kind === 'side')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [lines.lines]);
  const now = new Date();
  const items = paletteItems({ query, results, tabs: tabs.tabs, archived: tabs.archived, bookmarks, sides,
    today: tabs.today, dayText: (iso) => listTime(iso, now, timeZone) });
  const current = Math.min(active, Math.max(0, items.length - 1));
  useLayoutEffect(() => {
    play(box.current, phone ? PHONE_ENTER : ENTER, MOTION.base, EASE_OUT);
  }, [phone]);
  useEffect(() => {
    setActive(0);
  }, [query]);
  useLayoutEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  const close = (): void => {
    playThen(box.current, [...(phone ? PHONE_ENTER : ENTER)].reverse(), MOTION.fast, onClose);
  };
  const choose = (item: PaletteItem | undefined): void => {
    if (item === undefined) return;
    onOpen(item.target);
    onClose();
  };
  let lastGroup: PaletteGroup | null = null;
  return createPortal(
    <div className="palette-layer" data-phone={phone}>
      <div className="palette-scrim" onPointerDown={close} />
      <div ref={box} className="palette" role="dialog" aria-modal="true" aria-label="搜索和切换"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current + step + items.length) % Math.max(1, items.length));
          } else if (event.key === 'Enter' && !composing && !event.nativeEvent.isComposing) {
            event.preventDefault();
            choose(items[current]);
          }
        }}>
        <div className="palette-input-row">
          <Icon name="search" size={16} />
          <input className="palette-input" autoFocus aria-label="搜索和切换" placeholder="搜标签、书签、笔记、空间…"
            value={query} role="combobox" aria-expanded="true" aria-controls="palette-list"
            aria-activedescendant={items[current] === undefined ? undefined : `palette-${current}`}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
          {phone ? <button type="button" className="text-button" onClick={close}>取消</button>
            : <span className="kbd">esc</span>}
        </div>
        <div ref={list} id="palette-list" className="palette-list" role="listbox" aria-label="结果">
          {error === null ? null : <p className="palette-note" role="alert">{error}</p>}
          {items.map((item, index) => {
            const head = item.group !== lastGroup ? GROUP_LABELS[item.group] : null;
            lastGroup = item.group;
            return (
              <div key={item.key} role="presentation">
                {head === null ? null : <div className="palette-group" role="presentation">{head}</div>}
                <div id={`palette-${index}`} role="option" aria-selected={index === current}
                  data-active={index === current} className="palette-row" onPointerMove={() => setActive(index)}
                  onClick={() => choose(item)}>
                  <Lead item={item} spaces={spaces} />
                  <span className="palette-title">{item.title}</span>
                  {item.meta === '' ? null : <span className="palette-meta">{item.meta}</span>}
                  {index === current && !phone ? <span className="kbd" aria-hidden="true">↵</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        {phone ? null : (
          <div className="palette-foot">
            <span><span className="kbd">↑↓</span> 选择</span>
            <span><span className="kbd">↵</span> 打开</span>
            <span className="palette-foot-spacer" />
            <InfoTip label="查找范围" text={SCOPE_NOTE} side="top" />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
