// 网页工具条的地址框（11-07 设计稿 Web）：平时是网站名（--fg）加路径（--fg2），前面一把锁或 ✦；点一下换成整个网址的
// 输入框（选中全部），回车交给原生层换地址（像网址的补 https://，不像的当搜索词），Esc 或离开收回。
// 没有原生网页标签（网页版、手机浏览器）时只显示网址，点不进去。

import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { WebTab } from '../state/web-tabs.ts';
import { addressToUrl, type NativeWebTabs } from './use-native-web-tabs.ts';

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch (cause) {
    console.warn('网址解析不了，原样显示', cause);
    return url;
  }
}

/** 网址里网站名后面那一段（路径、查询），不带开头的 /。 */
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
  /** 换好地址、按 Esc 或离开输入框：收回成网站名。 */
  onDone: () => void;
}

function AddressField(props: AddressFieldProps): ReactNode {
  const { tab, url, native, leading, onDone } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const typed = draft ?? url;
    const next = addressToUrl(typed);
    setDraft(null);
    if (next !== null) {
      native.navigate(tab.id, next);
    }
    onDone();
  };
  return (
    <form ref={form} className="web-address web-address-form" data-editing="true" onSubmit={submit}>
      {leading}
      <input ref={input} className="web-address-input" aria-label="网址" value={draft ?? url} spellCheck={false}
        autoCapitalize="off" autoCorrect="off" enterKeyHint="go"
        onChange={(event) => setDraft(event.target.value)} onBlur={() => {
          setDraft(null);
          onDone();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setDraft(null);
            onDone();
          }
        }} />
    </form>
  );
}

export interface WebAddressProps {
  tab: WebTab;
  url: string;
  /** 没有原生网页标签时是 null：只显示网站名。 */
  native: NativeWebTabs | null;
  /** 网站名前面：锁 / ✦。 */
  leading: ReactNode;
}

export function WebAddress(props: WebAddressProps): ReactNode {
  const { tab, url, native, leading } = props;
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
    </div>
  );
}
