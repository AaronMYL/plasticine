import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { FeedItemView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import { useRoute } from '../../shell/use-route.ts';
import { useObjectTarget } from '../../state/use-object-target.ts';
import { useStore } from '../../state/use-store.ts';
import { FeedCard } from './feed-card.tsx';
import { FeedComments } from './feed-comments.tsx';

// 单条读取独立于列表的日期、收藏、不感兴趣筛选；离开时保留列表原本的范围。直达的这一条是一张卡，下面是对它记的想法
// （第 3 批起卡片底部只留 收藏 · 问 Plasticine · 不感兴趣 · 打开原文，记想法在这里）。
export function FeedTarget({ id }: { id: string }): ReactNode {
  const api = useApi();
  const live = useLive();
  const { navigate } = useRoute();
  const cached = useStore(live.feed.data).items.find((row) => row.id === id);
  const [item, setItem] = useState<FeedItemView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const accept = (value: FeedItemView): void => {
      setItem((current) => current !== null && current.version > value.version ? current : value);
      setError(null);
    };
    const load = async (): Promise<void> => {
      setError(null);
      try {
        const value = await api.feed.get(id, controller.signal);
        if (!controller.signal.aborted) { accept(value); }
      } catch (cause) {
        if (!controller.signal.aborted) { setError(errorText(cause)); }
      }
    };
    void load();
    const stop = live.hub.on((event) => {
      if (event.type === 'feed.changed' && event.item.id === id) { accept(event.item); }
      if (event.type === 'resync') { void load(); }
    });
    return () => { controller.abort(); stop(); };
  }, [api, live, id, attempt]);
  const shown = cached !== undefined && (item === null || cached.version > item.version) ? cached : item;
  const highlighted = useObjectTarget(`feed-target-${id}`, shown !== null);
  return <div className="page feed">
    <PageHeader title="信息流" controls={
      <button type="button" className="text-button" onClick={() => navigate({ view: 'feed', noteId: null })}>
        返回信息流
      </button>
    } />
    {error === null ? null : <p className="block-empty is-error" role="alert">{error}{' '}
      <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>
        重读这条信息
      </button>
    </p>}
    {shown === null ? error === null ? <p className="block-empty" role="status">正在读这条信息…</p> : null :
      <section className="block" aria-label="直达的信息" id={`feed-target-${id}`} tabIndex={-1}
        data-target-highlight={highlighted}>
        <div className="feed-target" role="list"><FeedCard item={shown} /></div>
        <FeedComments item={shown} />
      </section>}
  </div>;
}
