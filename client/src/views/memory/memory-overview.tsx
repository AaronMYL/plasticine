// 记忆首页的两块（11-11 记忆改版，设计稿「记忆首页」）：
// - 总览：最近一次全量整理写的一段话，右边「全量整理」；正在整理时按钮换成一句状态；有清单没看就是「整理清单 n 条」入口。
// - 队友：每位队友一行，点进去是只对它的规则（规则页按这位队友筛），共用的规则不再混在里面。

import { useState, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import { cleanupRoute, soulRoute, type Route } from '../../shell/routes.ts';
import { Icon } from '../../shell/icons.tsx';
import { useStore } from '../../state/use-store.ts';
import { MateAvatar } from '../mates/mate-avatar.tsx';
import { useCleanup } from './use-cleanup.ts';

export function MemoryOverview({ navigate, now = new Date() }: { navigate: (route: Route) => void; now?: Date }):
  ReactNode {
  const cleanup = useCleanup();
  const [error, setError] = useState<string | null>(null);
  const view = cleanup.data?.cleanup ?? null;
  const pending = view?.status === 'ready' ? view.items.filter((item) => item.applied === null).length : 0;
  const overview = cleanup.data?.overview ?? null;
  const running = view?.status === 'running';
  return (
    <section className="memory-overview" aria-label="总览">
      <div className="memory-overview-head">
        <h2 className="block-title">总览</h2>
        {overview === null ? null : <span className="text-meta">{relativeTime(overview.at, now)}整理</span>}
        <span className="memory-overview-spacer" />
        {running ? <span className="text-meta" role="status">正在整理…</span>
          : <button type="button" className="secondary-button button-small" onClick={() => {
            setError(null);
            void cleanup.start().then((problem) => {
              setError(problem);
              if (problem === null) navigate(cleanupRoute());
            });
          }}>全量整理</button>}
      </div>
      {overview === null ? null : <p className="memory-overview-text">{overview.text}</p>}
      {error === null ? null : <p className="text-meta is-error" role="alert">{error}</p>}
      {pending === 0 ? null : (
        <button type="button" className="topic-row memory-overview-list" onClick={() => navigate(cleanupRoute())}>
          <span className="topic-row-text"><span className="topic-row-title">整理清单 {pending} 条，等你勾选</span></span>
          <span className="topic-row-chevron" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
        </button>
      )}
    </section>
  );
}

export function TeammatesBlock({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const live = useLive();
  const mates = useStore(live.mates.data).mates;
  if (mates.length === 0) return null;
  return (
    <section className="block memory-block topic-group" aria-labelledby="topics-mates">
      <div className="memory-block-head">
        <h2 id="topics-mates" className="block-title">队友</h2>
        <span className="block-meta text-mono">{mates.length}</span>
      </div>
      <ul className="topic-list">
        {mates.map((mate) => (
          <li key={mate.id}>
            <button type="button" className="topic-row" onClick={() => navigate(soulRoute(mate.id))}>
              <MateAvatar mate={mate} size={20} />
              <span className="topic-row-text">
                <span className="topic-row-title">{mate.name}</span>
                <span className="topic-row-summary">{mate.role}；只对它的规则在这里</span>
              </span>
              <span className="topic-row-chevron" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
