import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { WebTab } from '../state/web-tabs.ts';
import { useLive } from '../live.tsx';
import { useStore } from '../state/use-store.ts';
import { Icon } from './icons.tsx';
import { readSearchEngine, SEARCH_ENGINE_LABELS } from './search-engine.ts';
import { addressToUrl, typedUrl, type NativeWebTabs } from './use-native-web-tabs.ts';

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch (cause) {
    console.warn('网址解析不了，原样显示', cause);
    return url;
  }
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    const rest = `${parsed.pathname}${parsed.search}`;
    return rest === '/' ? '' : rest;
  } catch (cause) {
    console.warn('网址解析不了，不写路径', cause);
    return '';
  }
}

interface AddressFieldProps {
  tab: WebTab;
  url: string;
  native: NativeWebTabs;
  leading: ReactNode;
  onDone: () => void;
}

export interface AddressSuggestion {
  kind: 'bookmark' | 'history' | 'go';
  title: string;
  url: string;
}

const SUGGEST_MAX = 6;
const SUGGEST_ICONS = { bookmark: 'bookmark', history: 'clock', go: 'search' } as const;

export function addressSuggestions(typed: string, bookmarks: readonly { title: string; target: string | null }[],
  visits: readonly { title: string; url: string }[]): AddressSuggestion[] {
  const text = typed.trim();
  const direct = addressToUrl(text);
  if (text === '' || direct === null) {
    return [];
  }
  const needle = text.toLocaleLowerCase();
  const hit = (title: string, url: string): boolean => title.toLocaleLowerCase().includes(needle)
    || url.toLocaleLowerCase().includes(needle);
  const seen = new Set<string>([direct]);
  const found: AddressSuggestion[] = [];
  const add = (kind: 'bookmark' | 'history', title: string, url: string): void => {
    if (found.length < SUGGEST_MAX - 1 && !seen.has(url) && hit(title, url)) {
      seen.add(url);
      found.push({ kind, title: title.trim() === '' ? hostOf(url) : title, url });
    }
  };
  for (const bookmark of bookmarks) {
    if (bookmark.target !== null && /^https?:/i.test(bookmark.target)) {
      add('bookmark', bookmark.title, bookmark.target);
    }
  }
  for (const visit of visits) add('history', visit.title, visit.url);
  const isUrl = typedUrl(text) !== null;
  const title = isUrl ? `打开 ${text}` : `用${SEARCH_ENGINE_LABELS[readSearchEngine()]}搜「${text}」`;
  return [...found, { kind: 'go', title,
    url: direct }];
}

function AddressField(props: AddressFieldProps): ReactNode {
  const { tab, url, native, leading, onDone } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const [picked, setPicked] = useState(-1);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const bookmarks = useStore(useLive().bookmarks.data).bookmarks;
  const visits = useStore(native.history.store);
  const suggestions = draft === null ? [] : addressSuggestions(draft, bookmarks, visits);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const go = (next: string | null): void => {
    setDraft(null);
    if (next !== null) {
      native.navigate(tab.id, next);
    }
    onDone();
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    go(suggestions[picked]?.url ?? addressToUrl(draft ?? url));
  };
  return (
    <form ref={form} className="web-address web-address-form" data-editing="true" onSubmit={submit}>
      {leading}
      <input ref={input} className="web-address-input" aria-label="网址" value={draft ?? url} spellCheck={false}
        autoCapitalize="off" autoCorrect="off" enterKeyHint="go" role="combobox" aria-autocomplete="list"
        aria-expanded={suggestions.length > 0} aria-controls="web-address-suggestions"
        aria-activedescendant={picked < 0 ? undefined : `web-address-suggestion-${picked}`}
        onChange={(event) => {
          setDraft(event.target.value);
          setPicked(-1);
        }} onBlur={() => {
          setDraft(null);
          onDone();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return;
          }
          if (event.key === 'Escape') {
            setDraft(null);
            onDone();
          } else if (suggestions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            const last = suggestions.length - 1;
            setPicked((current) => (event.key === 'ArrowDown' ? (current >= last ? -1 : current + 1)
              : current <= -1 ? last : current - 1));
          }
        }} />
      {suggestions.length === 0 ? null : (
        <ul id="web-address-suggestions" className="web-suggest" role="listbox" aria-label="建议"
          data-hit-region="web-suggest">
          {suggestions.map((item, index) => (
            <li key={`${item.kind}:${item.url}`} id={`web-address-suggestion-${index}`} role="option"
              aria-selected={index === picked} className="web-suggest-item"
              onMouseDown={(event) => event.preventDefault()} onClick={() => go(item.url)}>
              <Icon name={SUGGEST_ICONS[item.kind]} size={14} />
              <span className="web-suggest-title">{item.title}</span>
              {item.kind === 'go' ? null : <span className="web-suggest-url">{hostOf(item.url)}</span>}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

export interface WebAddressProps {
  tab: WebTab;
  url: string;
  native: NativeWebTabs | null;
  leading: ReactNode;
  trailing?: ReactNode;
}

export function WebAddress(props: WebAddressProps): ReactNode {
  const { tab, url, native, leading, trailing } = props;
  const [editing, setEditing] = useState(false);
  const host = hostOf(url);
  if (editing && native !== null) {
    return <AddressField tab={tab} url={url} native={native} leading={leading} onDone={() => setEditing(false)} />;
  }
  const shown = <>
    <span className="web-address-site">{host}</span>
    <span className="web-address-path">{pathOf(url)}</span>
  </>;
  return (
    <div className="web-address">
      {leading}
      {native === null ? <span className="web-address-host">{shown}</span> : (
        <button type="button" className="web-address-host" aria-label={`网址：${url}`}
          onClick={() => setEditing(true)}>{shown}</button>
      )}
      {trailing}
    </div>
  );
}
