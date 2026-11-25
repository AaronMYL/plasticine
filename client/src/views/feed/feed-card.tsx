import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FEED_PLACE_LABELS } from '../../api/shared.ts';
import type { FeedItemView } from '../../api/types.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { feedItemOpKey } from '../../state/daily-action-requests.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { useHeightMorph } from '../../shell/motion.ts';
import { useMention } from '../conversation/mention-button.tsx';
import { DouyinMark, FeedChartView, FeedText, FeedVideoBody, videoMeta } from './feed-body.tsx';
import { RedditMark } from './feed-source-list.tsx';
import { useOps } from '../../state/ops.ts';
import { FEED_IMAGE_BOX, ImageGrid } from '../../primitives/image-grid/index.tsx';
import { timeText } from '../../shell/time-text.ts';

export interface CardSource {
  name: string;
  handle: string | null;
  avatar: string | null;
  round: boolean;
}

export function sourceOf(item: FeedItemView): CardSource {
  if (item.kind === 'douyin') {
    const author = item.author?.name ?? null;
    return { name: author === null ? '抖音收藏' : `抖音收藏 · ${author}`, handle: videoMeta(item), avatar: null,
      round: false };
  }
  if (item.kind === 'x' && item.author !== null) {
    return { name: item.author.name, handle: item.author.handle === null ? null : `@${item.author.handle}`,
      avatar: item.author.avatar, round: true };
  }
  if (item.kind === 'rss') {
    return { name: item.sourceLabel, handle: item.author?.name ?? item.site, avatar: null, round: false };
  }
  if (item.kind === 'reddit') {
    return { name: item.sourceLabel, handle: item.author?.name ?? null, avatar: null, round: true };
  }
  if (item.kind === 'xhs') {
    return { name: item.author?.name ?? '小红书', handle: '小红书', avatar: item.author?.avatar ?? null, round: true };
  }
  return { name: item.site ?? item.sourceLabel, handle: null, avatar: null, round: false };
}

function initial(name: string): string {
  const first = Array.from(name.replace(/^[@\s]+/, ''))[0] ?? '·';
  return first.toUpperCase();
}

export function SourceMark({ source }: { source: CardSource }): ReactNode {
  const [broken, setBroken] = useState(false);
  const shape = source.round ? 'is-round' : 'is-square';
  if (source.avatar !== null && !broken) {
    return <img className={`feed-mark ${shape}`} src={source.avatar} alt="" width={28} height={28}
      loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className={`feed-mark ${shape}`} aria-hidden="true">{initial(source.name)}</span>;
}

function CardMark({ item, source }: { item: FeedItemView; source: CardSource }): ReactNode {
  if (item.kind === 'douyin') {
    return <DouyinMark />;
  }
  return item.kind === 'reddit' ? <RedditMark size={28} /> : <SourceMark source={source} />;
}

function useFollowFocus(card: RefObject<HTMLElement | null>, collapsed: boolean): void {
  const last = useRef(collapsed);
  const pending = useRef(false);
  useLayoutEffect(() => {
    const element = card.current;
    if (element === null) {
      return;
    }
    const active = document.activeElement;
    const followable = active === null || active === document.body || element.contains(active);
    if (last.current !== collapsed) {
      last.current = collapsed;
      pending.current = followable;
    }
    if (!pending.current || !followable) {
      pending.current = false;
      return;
    }
    const target = element.querySelector<HTMLButtonElement>(collapsed ? '.feed-undo-button' : '[data-dislike]');
    if (target !== null && !target.disabled) {
      target.focus({ preventScroll: true });
      pending.current = false;
    }
  });
}

function Dismissed({ locked, onUndo }: { locked: boolean; onUndo: () => void }): ReactNode {
  const note = useId();
  return (
    <div className="feed-undo">
      <span className="feed-undo-note" id={note} role="status">已收起，以后少推这类</span>
      <button type="button" className="text-button feed-undo-button" aria-describedby={note} disabled={locked}
        onClick={onUndo}>撤销</button>
    </div>
  );
}

export function FeedCard({ item, collapsed = false }: { item: FeedItemView; collapsed?: boolean }): ReactNode {
  const live = useLive();
  const actions = live.feedActions;
  const ops = useOps(`feed:${item.id}:`);
  const lockedReact = ops.some((op) => op.key === feedItemOpKey(item.id, 'react') && isOpenOp(op));
  const lockedSave = ops.some((op) => op.key === feedItemOpKey(item.id, 'save') && isOpenOp(op));
  const [shown, setShown] = useState(collapsed);
  if (!lockedReact && shown !== collapsed) {
    setShown(collapsed);
  }
  const ref = useRef<HTMLElement>(null);
  useHeightMorph(ref, shown ? 'collapsed' : 'card');
  useFollowFocus(ref, shown);
  return (
    <article ref={ref} className="feed-card" role="listitem" aria-label={item.title} data-kind={item.kind}
      data-hidden={item.reaction === 'dislike'} data-collapsed={shown || undefined}>
      {shown ? <Dismissed locked={lockedReact} onUndo={() => void actions.react(item, 'dislike')} />
        : <CardBody item={item} lockedReact={lockedReact} lockedSave={lockedSave} />}
      <OpLines ops={ops} onRetry={(key) => void actions.retry(key)} onDismiss={(key) => actions.dismiss(key)} />
    </article>
  );
}

interface CardBodyProps {
  item: FeedItemView;
  lockedReact: boolean;
  lockedSave: boolean;
}

function CardBody({ item, lockedReact, lockedSave }: CardBodyProps): ReactNode {
  const live = useLive();
  const timeZone = useTimeZone();
  const actions = live.feedActions;
  const mention = useMention();
  const discuss = (itemId: string): void => {
    mention({ type: 'feed', id: itemId, label: item.title, text: item.summary });
  };
  const source = sourceOf(item);
  const hit = item.concernId !== null;
  const at = item.publishedAt ?? item.arrivedAt;
  const caption = `${source.name}${source.handle === null ? '' : ` · ${source.handle}`}`;
  const pictures = [...(item.image === null ? [] : [item.image]), ...item.moreImages]
    .map((image) => ({ src: image.src, ratio: image.ratio, caption, original: item.url }));
  const liked = item.reaction === 'like';
  return (
    <>
      <header className="feed-card-head">
        <CardMark item={item} source={source} />
        <div className="feed-card-source">
          <span className="feed-card-name">{source.name}</span>
          {source.handle === null ? null : <span className="feed-card-handle">{source.handle}</span>}
        </div>
        {(item.places ?? []).map((place) => (
          <span key={place} className="feed-place">{FEED_PLACE_LABELS[place]}</span>
        ))}
        <time className="feed-card-time" dateTime={at}>
          {timeText(at, new Date(), timeZone)}
        </time>
        {item.why === '' ? null : (
          <InfoTip className="feed-card-why" label="为什么推给你" text={item.why} />
        )}
      </header>
      {hit ? <span className="feed-hit"><span className="feed-hit-dot" aria-hidden="true" />
        {item.topic ?? item.sourceLabel}</span> : null}
      {item.kind === 'douyin' ? <FeedVideoBody item={item} /> : <FeedText item={item} />}
      {item.chart == null ? null : <FeedChartView chart={item.chart} />}
      {pictures.length === 0 ? null : (
        <div className="feed-card-media"><ImageGrid box={FEED_IMAGE_BOX} images={pictures} /></div>
      )}
      <footer className="feed-card-actions">
        <IconButton icon={liked ? 'heart-filled' : 'heart'} label="点赞" aria-pressed={liked} disabled={lockedReact}
          onClick={() => void actions.react(item, 'like')} />
        <IconButton icon={item.saved ? 'star-filled' : 'star'} label={item.saved ? '已收藏' : '收藏'}
          aria-pressed={item.saved} disabled={lockedSave}
          onClick={() => void actions.toggleSave(item)} />
        <IconButton icon="conversation" label="讨论" onClick={() => discuss(item.id)} />
        <IconButton icon="close" label="不感兴趣" aria-pressed={item.reaction === 'dislike'} data-dislike=""
          disabled={lockedReact}
          onClick={() => void actions.react(item, 'dislike')} />
        <span className="feed-card-spacer" />
        {item.url === null ? null : (
          <a className="icon-button" href={item.url} target="_blank" rel="noopener noreferrer" aria-label="打开原文"
            data-tip="打开原文"><Icon name="external" /></a>
        )}
      </footer>
    </>
  );
}
