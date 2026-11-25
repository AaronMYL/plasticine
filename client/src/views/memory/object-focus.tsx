import { useCallback, useEffect, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { Quote } from '../../api/types.ts';
import { routeHash, type Route } from '../../shell/routes.ts';
import { useRead } from './use-read.ts';
import { SourceContextView } from './source-context.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

export function ObjectFocus({ id, readOnly = false, onQuote }: { id: string; readOnly?: boolean;
  onQuote?: ((quote: Quote | null) => void) | undefined;
}): ReactNode {
  const api = useApi();
  const read = useCallback((signal: AbortSignal) => api.memory.entry(id, signal), [api, id]);
  const { value, error, reload } = useRead(read);
  useEffect(() => {
    if (value === null) {
      onQuote?.(null);
      return;
    }
    const route: Route = { view: 'memory', noteId: null, objectId: id, objectType: 'memory_entry' };
    onQuote?.({ id: `quote_memory_${id}_${value.entry.version}`, kind: 'object', sourceId: id, label: '来源原话',
      text: `来源原话\n${routeHash(route)}\n${value.entry.text}` });
  }, [id, value, onQuote]);
  if (error !== null) {
    return <p role="alert">{error} <button type="button" className="text-button" onClick={reload}>重读这条</button></p>;
  }
  if (value === null) { return <PageLoading rows={3} />; }
  return <section className="block" aria-label="引用的条目">
    <h2 className="block-title">引用的条目</h2>
    <p className="text-meta">整理进主题记忆之前的一条{value.entry.kind === 'quote' ? '原话' : '解释'}（只读）</p>
    <q className="mem-quote">{value.entry.text}</q>
    <SourceContextView source={value.sourceContext} />
    {readOnly ? null : <a className="text-button" href="#/memory">看现在的主题记忆</a>}
  </section>;
}
