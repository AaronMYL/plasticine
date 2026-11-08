// 设置 · 信息流来源（第 3 批，用户 11-04 定）：每个来源一行——X 上你关注的人、每个订阅、按关注点搜新闻；行里是开关、
// 频率或地址，抓 / 读不到时那一行写原因（不弹卡）。11-04 他又定整行不挂浮框：上次读到的时间收进行里一个 ⓘ 按钮的
// tooltip（读到过才有）。段头右边「加订阅」，只要网址。关注点（搜什么、多少）在 ⋯ 里打开，和信息流页「加来源」同一块。

import { useEffect, useState, type ReactNode } from 'react';
import type { FeedSourceView } from '../../api/types.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { feedLevelOpKey } from '../../state/m4-action-requests.ts';
import { useStore } from '../../state/use-store.ts';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { openExternal } from '../../shell/open-external.ts';
import { RevealMore, type RevealAction } from '../../shell/reveal-more.tsx';
import { usePhone } from '../../shell/use-viewport-width.ts';
import { FeedSources } from '../feed/feed-sources.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { FeedSubscription } from '../feed/feed-subscription.tsx';
import { when } from '../notes/note-time.ts';
import { SectionHead } from './section-head.tsx';
import '../feed/feed.css';
import './feed-sources.css';

/** 每天 7 点按关注点搜一次（agent/src/daily/external-feed.ts FETCH_HOUR）。 */
const NEWS_HOUR = '07:00';
const X_HOME = 'https://x.com/home';
const NEWS_REF = 'internal:news';
const DEFAULT_EVERY_MINUTES = 120;

interface RowProps {
  source: FeedSourceView;
  lead: ReactNode;
  detail: string;
  actions: readonly RevealAction[];
}

function SourceRow({ source, lead, detail, actions }: RowProps): ReactNode {
  const live = useLive();
  const timeZone = useTimeZone();
  const okAt = source.status?.okAt ?? null;
  const last = okAt === null ? null : `上次读到：${when(okAt, new Date(), timeZone)}`;
  const op = useOp(feedLevelOpKey(source.id));
  const locked = op !== undefined && isOpenOp(op);
  const error = source.status?.error ?? null;
  return (
    <li className="feed-source-row" aria-label={source.label}>
      {lead}
      <span className="feed-source-row-name">{source.label}</span>
      <span className={error === null ? 'feed-source-row-detail' : 'feed-source-row-detail is-error'}>
        {error === null ? null : <StatusGlyph status="err" label="上次没成" />}
        {error ?? detail}
      </span>
      {last === null ? null : (
        <InfoTip className="feed-source-row-last" label={`「${source.label}」上次读到的时间`} text={last} />
      )}
      <input type="checkbox" role="switch" aria-label={source.label} checked={source.level !== 'off'}
        disabled={locked} onChange={(event) => void live.feedActions.setLevel(source,
          event.target.checked ? 'normal' : 'off')} />
      <RevealMore label={`「${source.label}」的更多操作`} actions={actions} />
      {op === undefined ? null : <OpLines ops={[op]} onRetry={(key) => void live.feedActions.retry(key)}
        onDismiss={(key) => live.feedActions.dismiss(key)} />}
    </li>
  );
}

export function FeedSourcesSection(): ReactNode {
  const live = useLive();
  const phone = usePhone();
  const data = useStore(live.feed.sources);
  const [adding, setAdding] = useState(false);
  const [interests, setInterests] = useState(false);
  useEffect(() => {
    void live.feed.loadSources();
  }, [live.feed]);
  const sources = data.sources;
  const others = sources?.others ?? [];
  const hours = (sources?.everyMinutes ?? DEFAULT_EVERY_MINUTES) / 60;
  const x = others.filter((source) => source.kind === 'x');
  const subscriptions = others.filter((source) => source.kind === 'rss');
  const news = others.filter((source) => source.ref === NEWS_REF);
  const searching = (sources?.interests ?? []).filter((source) => source.level !== 'off').length;
  return (
    <section className="block feed-sources-head" aria-labelledby="settings-feed-sources">
      <SectionHead id="settings-feed-sources" title="信息流来源">
        <button type="button" className="chip-button" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          加订阅
        </button>
      </SectionHead>
      {adding ? <FeedSubscription /> : null}
      {data.error === null ? null : (
        <p className="block-empty is-error" role="alert">{data.error}{' '}
          <button type="button" className="text-button" onClick={() => void live.feed.loadSources()}>重新读取</button>
        </p>
      )}
      {sources === null ? <p className="block-empty">正在读来源…</p> : (
        <ul className="feed-source-rows" aria-label="信息流来源">
          {x.map((source) => (
            <SourceRow key={source.id} source={source}
              lead={<span className="feed-mark is-round" aria-hidden="true">X</span>}
              detail={`Mac 在线时每 ${hours} 小时读一次`}
              actions={[{ icon: 'globe', label: '在 Plasticine 浏览器里打开 X',
                onSelect: () => openExternal(X_HOME, 'X') }]} />
          ))}
          {subscriptions.map((source) => (
            <SourceRow key={source.id} source={source} lead={<HueTile hue="ink" icon="feed" size={24} />}
              detail={source.query ?? ''}
              actions={source.query === null ? [] : [{ icon: 'external', label: '打开订阅地址',
                onSelect: () => openExternal(source.query ?? '', source.label) }]} />
          ))}
          {news.map((source) => (
            <SourceRow key={source.id} source={source} lead={<HueTile hue="ink" icon="search" size={24} />}
              detail={`${searching} 个关注点 · 每天 ${NEWS_HOUR}`}
              actions={[{ icon: 'sliders', label: '关注点…', onSelect: () => setInterests(true) }]} />
          ))}
        </ul>
      )}
      <Sheet open={interests} variant={phone ? 'drawer' : 'panel'} title="关注点" onClose={() => setInterests(false)}>
        <FeedSources />
      </Sheet>
    </section>
  );
}
