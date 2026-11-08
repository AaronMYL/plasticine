// 发送前先看到引用对象与实际范围。失败停在输入框，只有明确选仅标题或移除来源才改变发送内容。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import {
  CONVERSATION_QUOTE_MAX_CHARS, CONVERSATION_QUOTE_MAX_COUNT, quoteCharacters, quoteLimitMessage,
} from '../../api/shared.ts';
import type { Quote } from '../../api/types.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { useCurrentTab, type CurrentTab } from '../../shell/current-tab-context.ts';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { routeHash } from '../../shell/routes.ts';
import { useContactQuote } from '../contacts/contact-context.ts';
import { titlePageQuote, type PageQuoteResult } from './ask-this-page.tsx';
import { readPageContext } from './page-context-source.ts';

/** 标题、网址及截断说明占用的引用余量。 */
const PAGE_QUOTE_HEADROOM = 1_000;
export const PAGE_UNREAD_NOTE = '没读到这一页的正文。重试，或仅引用标题。';

export function askablePage(tab: CurrentTab | null): tab is CurrentTab {
  if (tab === null) return false;
  const route = tab.route;
  if (route === null) return true;
  if (route.view === 'web' || route.view === 'work' || route.view === 'plasticine') return false;
  if (route.view === 'messages') return route.contactId != null;
  return true;
}

export function pageBudget(sent: readonly Quote[]): number | null {
  if (sent.length >= CONVERSATION_QUOTE_MAX_COUNT) return null;
  const used = sent.reduce((sum, quote) => sum + quoteCharacters(quote.text), 0);
  const left = CONVERSATION_QUOTE_MAX_CHARS - used - PAGE_QUOTE_HEADROOM;
  return left > 0 ? left : null;
}

export interface PageContext {
  available: boolean;
  on: boolean;
  title: string | null;
  scope: string;
  loading: boolean;
  error: string | null;
  blocked: boolean;
  toggle: () => void;
  remove: () => void;
  retry: () => void;
  titleOnly: () => void;
  quoteFor: (sent: readonly Quote[]) => Promise<Quote | null>;
  committed: (quote: Quote | null) => void;
}

interface Preview {
  key: string;
  result: PageQuoteResult | null;
  error: string | null;
  loading: boolean;
}

function tabKey(tab: CurrentTab | null): string {
  return tab === null ? '' : JSON.stringify([tab.id, tab.kind, tab.url, tab.title,
    tab.route === null ? null : routeHash(tab.route)]);
}

export function usePageContext(enabled = true): PageContext {
  const tab = useCurrentTab();
  const api = useApi();
  const state = useClientState();
  const { shellPrefs, notesCache, noteDrafts } = state;
  const on = useStore(shellPrefs.store).askPage;
  const contactText = useContactQuote(tab?.route ?? null);
  const notes = useStore(notesCache.store);
  const drafts = useStore(noteDrafts.store);
  const key = tabKey(tab);
  const noteId = tab?.route?.view === 'notes' ? tab.route.noteId : null;
  const version = noteId === null ? 0 : notes.get(noteId)?.note?.version ?? 0;
  const dirty = noteId !== null && drafts.has(noteId);
  const available = enabled && askablePage(tab);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [onlyTitle, setOnlyTitle] = useState<string | null>(null);
  const revision = useRef(0);
  const current = useRef({ key, on, available, tab });
  current.current = { key, on, available, tab };
  const lastSent = useRef<Quote | null>(null);
  const active = preview?.key === key ? preview : null;
  const titleOnly = onlyTitle === key;
  const title = active?.result?.title
    ?? (noteId === null ? null : notes.get(noteId)?.note?.title) ?? tab?.title ?? null;
  const read = useCallback(async (budget: number, force = false): Promise<PageQuoteResult> => {
    // 壳会因缓存状态重画并给出新的 tab 对象；只按页面身份触发读取，失败后等明确重试。
    const source = current.current;
    if (source.key !== key || !source.on || !source.available) {
      throw new Error('当前页已经改变，请确认来源后再发送。');
    }
    if (!askablePage(source.tab)) throw new Error('当前页没有可引用的内容。');
    const turn = ++revision.current;
    setPreview({ key, result: null, error: null, loading: true });
    try {
      const result = await readPageContext(source.tab, contactText, budget, api, state, force);
      if (turn !== revision.current || current.current.key !== key || !current.current.on) {
        throw new Error('当前页已经改变，请确认来源后再发送。');
      }
      const error = result.failed ? PAGE_UNREAD_NOTE : null;
      setPreview({ key, result, error, loading: false });
      if (error !== null) throw new Error(error);
      return result;
    } catch (cause) {
      if (turn === revision.current && current.current.key === key) {
        setPreview((previous) => ({ key, result: previous?.result ?? null,
          error: errorText(cause), loading: false }));
      }
      throw cause;
    }
  }, [key, contactText, api, state]);

  useEffect(() => {
    if (!available || !on || titleOnly) return;
    // 界面已显示错误；这里结束预读，不另外发消息或降级发送。
    void read(pageBudget([]) ?? 0).catch(() => undefined);
    return () => { revision.current += 1; };
  }, [available, on, titleOnly, read, version, dirty]);

  const quoteFor = async (sent: readonly Quote[]): Promise<Quote | null> => {
    if (!on || !available || !askablePage(tab)) return null;
    const budget = pageBudget(sent);
    if (budget === null) throw new Error('引用已满，请移除一段引用或取消当前页引用。');
    const result = titleOnly ? titlePageQuote({ ...tab, title: title ?? tab.title }) : await read(budget);
    if (current.current.key !== key || !current.current.on || !current.current.available) {
      throw new Error('来源已改变，请确认后再发送。');
    }
    const limit = quoteLimitMessage([...sent, result.quote]);
    if (limit !== null) throw new Error(limit);
    const previous = lastSent.current;
    const already = sent.some((quote) => quote.id === result.quote.id && quote.text === result.quote.text);
    return already || previous?.id === result.quote.id && previous.text === result.quote.text ? null : result.quote;
  };
  const remove = (): void => { revision.current += 1; shellPrefs.setAskPage(false); };
  return { available, on, title,
    scope: titleOnly ? '仅标题和链接' : active?.result?.scope ?? '读取中…',
    loading: !titleOnly && (active === null || active.loading),
    error: titleOnly ? null : active?.error ?? null,
    blocked: available && on && !titleOnly && (active === null || active.loading || active.error !== null),
    toggle: () => { setOnlyTitle(null); shellPrefs.setAskPage(!on); },
    remove,
    retry: () => { setOnlyTitle(null); void read(pageBudget([]) ?? 0, true).catch(() => undefined); },
    titleOnly: () => { revision.current += 1; setOnlyTitle(key); },
    quoteFor,
    committed: (quote) => { if (quote !== null) lastSent.current = quote; },
  };
}

export function AskPageToggle({ context }: { context: PageContext }): ReactNode {
  if (!context.available || context.on) return null;
  return (
    <button type="button" className="icon-button conv-ask-page" aria-pressed={false} aria-label="问这一页"
      aria-description={context.title === null ? undefined : `当前标签：${context.title}`}
      data-tip="问这一页" onClick={context.toggle}><Icon name="file" /></button>
  );
}

export function PageSource({ context }: { context: PageContext }): ReactNode {
  if (!context.available || !context.on) return null;
  return (
    <div className="line-page-source">
      <div className="line-source-chip" role="group" aria-label="当前页来源" aria-busy={context.loading}>
        <Icon name="file" size={14} />
        <span className="line-source-kind">当前页</span>
        <span className="line-source-title">{context.title}</span>
        <span className="line-source-scope">{context.error === null ? context.scope : '正文未载入'}</span>
        <IconButton icon="close" size={12} label="取消当前页引用" onClick={context.remove} />
      </div>
      {context.error === null ? null : (
        <div className="line-source-error" role="alert">
          <span>{context.error}</span>
          <div className="line-source-actions">
            <button type="button" className="text-button" aria-label="重试读取当前页"
              onClick={context.retry}>重试</button>
            <button type="button" className="text-button" onClick={context.titleOnly}>仅引用标题</button>
          </div>
        </div>
      )}
    </div>
  );
}
