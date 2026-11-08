import { useCallback, useEffect, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { useLive } from '../../live.tsx';
import type { Quote } from '../../api/types.ts';
import { routeHash, type Route } from '../../shell/routes.ts';
import { useRead } from './use-read.ts';
import { AgreementRow } from './agreement-row.tsx';
import { ChangeLog } from './change-log.tsx';
import { SourceContextView } from './source-context.tsx';

export function ObjectFocus({ id, type, readOnly = false, onQuote }: { id: string; type: Route['objectType'];
  readOnly?: boolean; onQuote?: ((quote: Quote | null) => void) | undefined;
}): ReactNode {
  const api = useApi();
  const live = useLive();
  const read = useCallback(async (signal: AbortSignal) => {
    if (type === 'memory_entry') {
      return { kind: 'memory' as const, detail: await api.memory.entry(id, signal) };
    }
    return { kind: 'agreement' as const, detail: await api.agreements.get(id, signal) };
  }, [api, id, type]);
  const { value, error, reload } = useRead(read);
  useEffect(() => {
    if (value === null) { onQuote?.(null); return; }
    const item = value.kind === 'memory' ? value.detail.entry : value.detail.agreement;
    const label = value.kind === 'agreement' ? value.detail.agreement.title ?? '这条约定' : '来源原话';
    const route: Route = { view: 'memory', noteId: null, objectId: id,
      objectType: value.kind === 'memory' ? 'memory_entry' : 'agreement' };
    onQuote?.({ id: `quote_memory_${id}_${item.version}`, kind: 'object', sourceId: id, label,
      text: `${label}\n${routeHash(route)}\n${item.text}` });
  }, [id, value, onQuote]);
  // 约定栏撤掉以后（第 4 批）一条约定只在这里单独读：别处改了它、或给它标了 ≠，都就地重读。
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'agreement.changed' && event.agreement.id === id) { reload(); }
  }), [live.hub, id, reload]);
  if (error !== null) {
    return <p role="alert">{error} <button type="button" className="text-button" onClick={reload}>重读这条</button></p>;
  }
  if (value === null) { return <p className="block-empty">正在读引用的这一条…</p>; }
  return <section className="block" aria-label="引用的条目">
    <h2 className="block-title">引用的条目</h2>
    {value.kind === 'memory' ? <>
      {/* 整理进主题文档之前的一条原话（2026-11-03 起只读）：只给原文和它来自哪里，不再能改、删、标过时。 */}
      <p className="text-meta">整理进主题记忆之前的一条{value.detail.entry.kind === 'quote' ? '原话' : '解释'}（只读）</p>
      <q className="mem-quote">{value.detail.entry.text}</q>
      <SourceContextView source={value.detail.sourceContext} />
      {readOnly ? null : <a className="text-button" href="#/memory">看现在的主题记忆</a>}
    </> : null}
    {value.kind === 'agreement' ? <>
      {readOnly ? <>
        {value.detail.agreement.title === null ? null : <h3 className="block-title">{value.detail.agreement.title}</h3>}
        <p className="mem-text">{value.detail.agreement.text}</p>
        {value.detail.agreement.userQuote === null ? null
          : <q className="mem-quote">{value.detail.agreement.userQuote}</q>}
      </> : <ul className="mem-list"><AgreementRow agreement={value.detail.agreement} /></ul>}
      <SourceContextView source={value.detail.sourceContext} />
      <ChangeLog title="版本来路" records={value.detail.history} now={new Date()} />
    </> : null}
  </section>;
}
