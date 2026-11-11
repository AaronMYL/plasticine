// 关注点的编辑器（第 7 批第 10 条起是第二栏「按关注点的新闻」那一行 ⋯ 里的「设置…」）：加关注点；关注点 · 不要的各一组，
// 每个来源一行：名字、查询词、档位（偏多 / 正常 / 偏少 / 关掉，分段控件；关掉不删）；最后是最近来源的网站和条数。
// 加订阅、Reddit、X、抖音收藏都在第二栏的「加来源」里，不在这里。读失败给「再读一次」。

import type { ReactNode } from 'react';
import type { FeedSourceView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { feedLevelOpKey } from '../../state/m4-action-requests.ts';
import { useStore } from '../../state/use-store.ts';
import { useOp } from '../pending/pending-ops.tsx';
import { FeedQuery } from './feed-query.tsx';
import { FeedInterest, FeedSite } from './feed-interest.tsx';

const LEVELS: ReadonlyArray<{ level: FeedSourceView['level']; label: string }> = [
  { level: 'more', label: '偏多' },
  { level: 'normal', label: '正常' },
  { level: 'less', label: '偏少' },
  { level: 'off', label: '关掉' },
];

function SourceRow({ source }: { source: FeedSourceView }): ReactNode {
  const live = useLive();
  const actions = live.feedActions;
  const op = useOp(feedLevelOpKey(source.id));
  const locked = op !== undefined && isOpenOp(op);
  const choose = (level: FeedSourceView['level']): void => {
    if (level !== source.level) {
      void actions.setLevel(source, level);
    }
  };
  if (source.kind === 'blocked_site') {
    return <li className="feed-source" aria-label={source.label}>
      <span>{source.label}</span>
      <button type="button" className="text-button" disabled={locked}
        onClick={() => choose('normal')}>恢复</button>
      <OpLines ops={op === undefined ? [] : [op]} onRetry={(key) => void actions.retry(key)}
        onDismiss={(key) => actions.dismiss(key)} />
    </li>;
  }
  return (
    <li className="feed-source" aria-label={source.label}>
      <div className="feed-source-name">
        {source.label}
        {source.kind === 'interest' ? <FeedQuery source={source} />
          : (source.query === null ? null : <span className="feed-source-query">{source.query}</span>)}
      </div>
      <div className="segmented" role="group" aria-label={`「${source.label}」的档位`}>
        {LEVELS.map((entry) => (
          <button
            key={entry.level}
            type="button"
            className="segmented-item"
            aria-pressed={source.level === entry.level}
            disabled={locked}
            onClick={() => choose(entry.level)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <OpLines
        ops={op === undefined ? [] : [op]}
        onRetry={(key) => void actions.retry(key)}
        onDismiss={(key) => actions.dismiss(key)}
      />
    </li>
  );
}

function Group({ title, sources }: { title: string; sources: readonly FeedSourceView[] }): ReactNode {
  if (sources.length === 0) { return null; }
  return (
    <div className="feed-source-group">
      <h3 className="feed-source-title">{title}</h3>
      <ul className="feed-source-list" aria-label={title}>
          {sources.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
      </ul>
    </div>
  );
}

export function FeedSources(): ReactNode {
  const live = useLive();
  const data = useStore(live.feed.sources);
  return (
    <section className="block feed-sources" aria-label="信息源">
      {data.status === 'loading' || data.status === 'idle' ? <p className="block-empty">正在读信息源…</p> : null}
      {data.error === null ? null : (
        <p className="block-empty is-error" role="alert">
          {data.error}{' '}
          <button type="button" className="text-button" onClick={() => void live.feed.loadSources()}>
            再读一次
          </button>
        </p>
      )}
      {data.sources === null ? null : (
        <>
          <FeedInterest />
          <Group title="关注点" sources={data.sources.interests} />
          <Group title="不要的" sources={data.sources.blocked.filter((source) => source.level === 'off')} />
          {data.sources.recentSites.length === 0 ? null : (
            <div className="feed-source-group">
              <h3 className="feed-source-title">最近来源</h3>
              <ul className="feed-sites" aria-label="最近来源">
                {data.sources.recentSites.map((site) => (
                  <FeedSite key={site.site} site={site.site} count={site.count}
                    blocked={data.sources!.blocked.some((source) => source.level === 'off'
                      && source.label.replace(/^www\./, '') === site.site.replace(/^www\./, ''))} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
