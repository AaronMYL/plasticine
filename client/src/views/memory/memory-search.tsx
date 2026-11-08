// 记忆页页头的搜索（《优化清单》第 16 条，11-06 定，设计稿 Plasticine-Memory）：「搜记忆，含归档」。有字时主区换成结果：
// 每行是那一句和它在哪一篇；归档里的（被取代的旧说法、过时的事实）标「归档」。点一行打开那一篇。

import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import type { MemorySearchHit } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import type { Route } from '../../shell/routes.ts';

// 停手这么久再搜：一个字一个字打时不连发请求。
const SEARCH_DELAY_MS = 200;

function Field({ value, onChange }: { value: string; onChange: (value: string) => void }): ReactNode {
  return (
    <label className="memory-search">
      <Icon name="search" size={14} />
      <input type="search" aria-label="搜记忆，含归档" placeholder="搜记忆，含归档" value={value}
        onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Results({ query, navigate }: { query: string; navigate: (route: Route) => void }): ReactNode {
  const live = useLive();
  const [hits, setHits] = useState<MemorySearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      live.memoryTopics.search(query.trim(), controller.signal).then((found) => {
        setHits(found);
        setError(null);
      }, (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorText(cause));
        }
      });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [live.memoryTopics, query]);
  if (error !== null) {
    return <p className="block-empty is-error" role="alert">{error}</p>;
  }
  if (hits === null) {
    return <p className="block-empty" role="status">正在搜…</p>;
  }
  if (hits.length === 0) {
    return <p className="block-empty" role="status">没有找到</p>;
  }
  return (
    <ul className="topic-list memory-hits" aria-label="搜到的记忆">
      {hits.map((hit) => (
        <li key={hit.lineId}>
          <button type="button" className="topic-row" data-archived={hit.archivedAt !== null}
            onClick={() => navigate({ view: 'memory', noteId: null, topicId: hit.topicId })}>
            <span className="topic-row-text">
              <span className="topic-row-title memory-hit-text">{hit.text}</span>
              <span className="topic-row-summary">{hit.topicTitle}</span>
            </span>
            {hit.archivedAt === null ? null : <span className="tag tag-outline-quiet">归档</span>}
            <span className="topic-row-chevron" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export const MemorySearch = { Field, Results };
