// 信息流的一张卡（第 3 批，用户 11-04 定的瀑布流）：头部是来源——X 用发帖人的头像、订阅和新闻用站点首字方块——名字、
// 账号 / 站点和时间常显；命中关注点的带陶土橙点 + 关注点名；X 的帖子没有标题，正文就是帖子；有图的大卡、没图的短卡。
// 卡底 赞 · 收藏 · 讨论（开一条旁聊，第 17 条） · 不感兴趣 · 打开原文，都是有名字的图标按钮，tooltip 就是名字；赞和收藏按下时图标
// 实心。11-04 他定：整张卡不挂浮框（划过就冒太吵）——来自哪一路由头像 / 站点方块 + 名字说清；挑这条的理由（新闻才有）
// 收进头部一个 ⓘ 按钮的 tooltip。点了「不感兴趣」，落定后整张卡就地收成一条矮的占位（照 X 的「不再推荐 · 撤销」），
// 高度平滑过渡；点「撤销」恢复原卡。焦点跟着走：收起时到「撤销」，恢复时回「不感兴趣」。
// 动作没了结时那几个按钮锁住，卡底出「再核实」「重发」。

import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { FeedItemView } from '../../api/types.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { feedItemOpKey } from '../../state/m4-action-requests.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { useHeightMorph } from '../../shell/motion.ts';
import { relativeTime } from '../../shell/relative-time.ts';
import { usePhone } from '../../shell/use-viewport-width.ts';
import { sideRoute } from '../../shell/routes.ts';
import { useRoute } from '../../shell/use-route.ts';
import { when } from '../notes/note-time.ts';
import { DouyinMark, FeedChartView, FeedText, FeedVideoBody, videoMeta } from './feed-body.tsx';
import { RedditMark } from './feed-source-list.tsx';
import { useOps } from '../../state/ops.ts';

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
    // 第 7 批第 13 条：Reddit 圆标 + r/版块 + u/作者。
    return { name: item.sourceLabel, handle: item.author?.name ?? null, avatar: null, round: true };
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

/** 卡片头的来源标：抖音的方块、Reddit 的圆标，别的按头像或首字。 */
function CardMark({ item, source }: { item: FeedItemView; source: CardSource }): ReactNode {
  if (item.kind === 'douyin') {
    return <DouyinMark />;
  }
  return item.kind === 'reddit' ? <RedditMark size={28} /> : <SourceMark source={source} />;
}

/**
 * 收起 / 恢复时焦点原来在卡里（或已经随按钮消失落到 body）就跟过去：收起到「撤销」，恢复回「不感兴趣」。请求还没了结时
 * 那个按钮锁着、接不住焦点，等它解锁再给。
 */
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

/** collapsed：这次刚点了「不感兴趣」、落定了，收成可撤销的占位（只在信息流列表里）。 */
export function FeedCard({ item, collapsed = false }: { item: FeedItemView; collapsed?: boolean }): ReactNode {
  const live = useLive();
  const actions = live.feedActions;
  const ops = useOps(`feed:${item.id}:`);
  const lockedReact = ops.some((op) => op.key === feedItemOpKey(item.id, 'react') && isOpenOp(op));
  const lockedSave = ops.some((op) => op.key === feedItemOpKey(item.id, 'save') && isOpenOp(op));
  // 请求没了结时卡上有一行「正在…」，这时不换样子：了结后一次收起 / 展开到位，高度过渡不在半路再跳一下。
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
  // 手机（设计稿 Phone-Feed）写「1 小时前」，电脑照旧写钟点。
  const phone = usePhone();
  const actions = live.feedActions;
  // 「讨论」开一条围绕这一条的旁聊（《优化清单》第 17 条）：带上这一条的内容，开好了直接过去。
  const { navigate } = useRoute();
  const discuss = (itemId: string): void => {
    void live.lines.openSide({ from: { kind: 'feed', itemId } }).then((opened) => {
      if (typeof opened !== 'string') navigate(sideRoute(opened.id));
    });
  };
  const source = sourceOf(item);
  const hit = item.concernId !== null;
  const at = item.publishedAt ?? item.arrivedAt;
  const ratio = item.image?.ratio ?? null;
  const liked = item.reaction === 'like';
  return (
    <>
      <header className="feed-card-head">
        <CardMark item={item} source={source} />
        <div className="feed-card-source">
          <span className="feed-card-name">{source.name}</span>
          {source.handle === null ? null : <span className="feed-card-handle">{source.handle}</span>}
        </div>
        <time className="feed-card-time" dateTime={at}>
          {phone ? relativeTime(at, new Date()) : when(at, new Date(), timeZone)}
        </time>
        {item.why === '' ? null : (
          <InfoTip className="feed-card-why" label="为什么推给你" text={item.why} />
        )}
      </header>
      {hit ? <span className="feed-hit"><span className="feed-hit-dot" aria-hidden="true" />
        {item.topic ?? item.sourceLabel}</span> : null}
      {item.kind === 'douyin' ? <FeedVideoBody item={item} /> : <FeedText item={item} />}
      {item.chart == null ? null : <FeedChartView chart={item.chart} />}
      {item.image === null ? null : (
        <img className="feed-card-image" src={item.image.src} alt="" loading="lazy" referrerPolicy="no-referrer"
          style={ratio === null ? undefined : { aspectRatio: `1 / ${ratio}` }} />
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
