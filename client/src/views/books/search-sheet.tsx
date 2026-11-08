// 在书里找：输入停 300 毫秒再查（打字时不每个字都打一次接口），命中处前后一小段，命中的字加粗；点一条跳过去。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { BookSearchHit } from '../../api/shared.ts';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { chapterShort } from './book-format.ts';

/** 停下多久才查：300 毫秒（任务书）。 */
export const SEARCH_DEBOUNCE_MS = 300;

export interface SearchSheetProps {
  open: boolean;
  phone: boolean;
  bookId: string;
  title: string;
  onPick: (hit: BookSearchHit) => void;
  onClose: () => void;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; hits: BookSearchHit[]; truncated: boolean }
  | { status: 'failed'; error: string };

function Results({ state, onPick }: { state: SearchState; onPick: (hit: BookSearchHit) => void }): ReactNode {
  if (state.status === 'idle') {
    return <p className="block-empty">输入要找的字，整本书里找。</p>;
  }
  if (state.status === 'loading') {
    return <p className="block-empty">正在找…</p>;
  }
  if (state.status === 'failed') {
    return <p className="block-empty is-error" role="alert">{state.error}</p>;
  }
  if (state.hits.length === 0) {
    return <p className="block-empty">这本书里没有找到。</p>;
  }
  return (
    <>
      <ul className="bk-hits" aria-label="找到的地方">
        {state.hits.map((hit) => (
          <li key={`${hit.chapter}:${hit.start}`}>
            <button type="button" className="bk-hit" onClick={() => onPick(hit)}>
              <span className="text-meta">{chapterShort(hit.chapterTitle)}</span>
              <span className="bk-hit-text">{hit.before}<b>{hit.match}</b>{hit.after}</span>
            </button>
          </li>
        ))}
      </ul>
      {state.truncated ? <p className="block-empty">只列出前 {state.hits.length} 处；换个更具体的词再找。</p> : null}
    </>
  );
}

export function SearchSheet(props: SearchSheetProps): ReactNode {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  useEffect(() => {
    const wanted = query.trim();
    if (!props.open || wanted === '') {
      setState({ status: 'idle' });
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ status: 'loading' });
      api.books.search(props.bookId, wanted, controller.signal).then((result) => {
        if (!controller.signal.aborted) {
          setState({ status: 'done', hits: result.hits, truncated: result.truncated });
        }
      }, (cause: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: 'failed', error: errorText(cause) });
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, props.bookId, props.open, query]);
  return (
    <Sheet open={props.open} variant={props.phone ? 'drawer' : 'panel'} title={`在《${props.title}》里找`}
      onClose={props.onClose}>
      <div className="bk-search">
        <input className="field-input" type="search" aria-label="要找的字" placeholder="要找的字" value={query}
          autoFocus onChange={(event) => setQuery(event.target.value)} />
        <Results state={state} onPick={props.onPick} />
      </div>
    </Sheet>
  );
}
