import { useEffect, useRef, useState } from 'react';
import { Value } from 'typebox/value';
import { useApi } from '../api/context.tsx';
import { errorText } from '../api/errors.ts';
import { createRequestId } from '../api/request-id.ts';
import { WebExtractImagesSchema, type WebExtractView } from '../api/shared.ts';
import { readPageSnapshot } from '../views/conversation/ask-this-page.tsx';
import type { NativeWebTabs } from './use-native-web-tabs.ts';

export function useWebExtract(tabId: string, url: string, native: NativeWebTabs | null) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<WebExtractView | null>(null);
  const [busy, setBusy] = useState<'extract' | 'archive' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const current = useRef(native);
  current.current = native;
  const request = useRef<AbortController | null>(null);
  const archiveId = useRef<string | null>(null);
  const clear = (): void => {
    if (current.current?.tools.has('extract_marks') !== true) return;
    void current.current.tool(tabId, { kind: 'extract_marks', points: [] })
      .catch((cause: unknown) => console.warn('网页重点未能清除', cause));
  };
  useEffect(() => {
    setOpen(false); setPage(null); setError(null); setSpaceId(null); setBusy(null); archiveId.current = null;
    return () => { request.current?.abort(); clear(); };
  }, [tabId, url]);

  const marks = (value: WebExtractView, focus?: number): void => {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--hue-ochre').trim();
    void current.current?.tool(tabId, { kind: 'extract_marks', points: value.points.map((point) => ({
      quote: point.quote, context: value.blocks.find((block) => block.index === point.block)?.text ?? '',
    })), ...(focus === undefined ? {} : { focus }), color: `color-mix(in srgb, ${color} 22%, transparent)` })
      .catch((cause: unknown) => setError(`重点未能标到原文：${errorText(cause)}`));
  };
  useEffect(() => { if (open && page !== null) marks(page); }, [page, open]);

  const extract = async (): Promise<void> => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setOpen(true); setBusy('extract'); setError(null); setSpaceId(null); archiveId.current = null;
    try {
      const snapshot = await readPageSnapshot(tabId);
      if (snapshot === null || snapshot.text.trim() === '') throw new Error('这里读不到网页正文，不能提取或归档。');
      const images = await current.current?.tool(tabId, { kind: 'extract_images' });
      if (!Value.Check(WebExtractImagesSchema, images)) throw new Error('网页图片格式不对，请重新读取。');
      const result = await api.browser.extract({ url: snapshot.url, title: snapshot.title, text: snapshot.text,
        totalChars: snapshot.totalChars, truncated: snapshot.truncated, images }, controller.signal);
      if (!controller.signal.aborted) setPage(result);
    } catch (cause) {
      if (!controller.signal.aborted) { setPage(null); setError(errorText(cause)); clear(); }
    } finally { if (!controller.signal.aborted) setBusy(null); }
  };
  const archive = async (): Promise<void> => {
    if (page === null || busy !== null) return;
    const controller = new AbortController(); request.current = controller;
    archiveId.current ??= createRequestId();
    setBusy('archive'); setError(null);
    try {
      const result = await api.browser.archive({ ...page, requestId: archiveId.current }, controller.signal);
      if (!controller.signal.aborted) setSpaceId(result.space.id);
    } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)); }
    finally { if (!controller.signal.aborted) setBusy(null); }
  };
  const close = (): void => { request.current?.abort(); setBusy(null); setOpen(false); clear(); };
  return { open, page, busy, error, spaceId, extract, archive, close,
    toggle: () => { if (open) close(); else if (page !== null) setOpen(true); else void extract(); },
    jump: (index: number) => { if (page !== null) marks(page, index); },
    remove: (index: number) => {
      setPage((value) => value === null ? null : { ...value, points: value.points.filter((_, i) => i !== index) });
      archiveId.current = null; setSpaceId(null);
    } };
}
