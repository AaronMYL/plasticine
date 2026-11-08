// 信息流页头「加来源」打开的 Sheet（第 3 批 11-04；以前叫「信息源」，用户视角审查 2026-11-01 第 11 条：阅读页里不常驻
// 空表单）：先是加订阅（只给网址）、加关注点；再是关注点 · 不要的各一组，每个来源一行：名字、查询词、档位（多 / 正常 /
// 少 / 关掉，分段控件；关掉不删，探索方向关切照旧）；最后是最近来源的网站和条数。X、订阅、按关注点搜新闻的开关和出错原因
// 在「设置 · 信息流」，这里给一个去那里的按钮。读失败给「重新读取」。

import type { ReactNode } from 'react';
import type { FeedSourceView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { feedLevelOpKey } from '../../state/m4-action-requests.ts';
import { useStore } from '../../state/use-store.ts';
import { useOp } from '../pending/pending-ops.tsx';
import { FeedSubscription } from './feed-subscription.tsx';
import { FeedQuery } from './feed-query.tsx';
import { FeedInterest, FeedSite } from './feed-interest.tsx';

const LEVELS: ReadonlyArray<{ level: FeedSourceView['level']; label: string }> = [
  { level: 'more', label: '多' },
  { level: 'normal', label: '正常' },
  { level: 'less', label: '少' },
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

/** 第 6 批第 9 条：抖音收藏一行，点开勾选清单。 */
function DouyinRow({ onOpen }: { onOpen: () => void }): ReactNode {
  return (
    <div className="feed-source-group">
      <h3 className="feed-source-title">抖音收藏</h3>
      <div className="feed-source">
        <span className="feed-source-name">选要处理的收藏，处理好的进信息流</span>
        <button type="button" className="secondary-button button-small" onClick={onOpen}>选收藏</button>
      </div>
    </div>
  );
}

export function FeedSources({ onManage, onDouyin }: { onManage?: () => void; onDouyin?: () => void }): ReactNode {
  const live = useLive();
  const data = useStore(live.feed.sources);
  return (
    <section className="block feed-sources" aria-label="信息源">
      {data.status === 'loading' || data.status === 'idle' ? <p className="block-empty">正在读信息源…</p> : null}
      {data.error === null ? null : (
        <p className="block-empty is-error" role="alert">
          {data.error}{' '}
          <button type="button" className="text-button" onClick={() => void live.feed.loadSources()}>
            重新读取
          </button>
        </p>
      )}
      {data.sources === null ? null : (
        <>
          <FeedSubscription />
          <FeedInterest />
          <Group title="关注点" sources={data.sources.interests} />
          {onDouyin === undefined ? null : <DouyinRow onOpen={onDouyin} />}
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
          {onManage === undefined ? null : (
            <button type="button" className="text-button feed-manage" onClick={onManage}>每个来源的开关和频率</button>
          )}
        </>
      )}
    </section>
  );
}
