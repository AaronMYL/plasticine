// 在页面中查找（第 2 批「浏览器」，⋯ 菜单 / ⌘F）：工具条下面一条查找框，回车找下一个、Shift+回车找上一个，
// Esc 或 ✕ 收起（原生的高亮一起收）。找由原生网页做（WKWebView.find，高亮并滚到那里）；找不到写「没找到」。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Value } from 'typebox/value';
import { WEB_FIND_MAX_CHARS, WebFindResultSchema } from '../api/shared.ts';
import { IconButton } from './icon-button.tsx';
import type { NativeWebTabs } from './use-native-web-tabs.ts';

export interface WebFindBarProps {
  tabId: string;
  native: NativeWebTabs;
  onClose: () => void;
}

export function WebFindBar({ tabId, native, onClose }: WebFindBarProps): ReactNode {
  const [query, setQuery] = useState('');
  const [missing, setMissing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const find = (backwards: boolean): void => {
    const text = query.trim();
    if (text === '') {
      return;
    }
    native.tool(tabId, { kind: 'find', query: text, backwards }).then((result) => {
      setMissing(Value.Check(WebFindResultSchema, result) && !result.found);
    }).catch((cause: unknown) => console.warn('在页面中查找没成', cause));
  };
  const close = (): void => {
    native.tool(tabId, { kind: 'find_clear' }).catch((cause: unknown) => console.warn('查找的高亮没能收起', cause));
    onClose();
  };
  return (
    <div className="web-find" role="search" aria-label="在页面中查找" data-tip-side="bottom">
      <input ref={input} className="web-find-input" type="search" aria-label="在页面中查找" placeholder="在页面中查找"
        value={query} maxLength={WEB_FIND_MAX_CHARS} aria-invalid={missing}
        onChange={(event) => {
          setQuery(event.target.value);
          setMissing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            find(event.shiftKey);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }} />
      {missing ? <span className="web-find-missing" role="status">没找到</span> : null}
      <IconButton icon="chevron-up" label="上一个" title="上一个 · Shift+回车" onClick={() => find(true)} />
      <IconButton icon="chevron-down" label="下一个" title="下一个 · 回车" onClick={() => find(false)} />
      <IconButton icon="close" label="收起查找" title="收起 · Esc" onClick={close} />
    </div>
  );
}
