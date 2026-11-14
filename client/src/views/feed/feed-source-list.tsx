// 信息流的来源列表（第 7 批第 10 条，设计稿 Feed-Sources；第13批按种类合成一行，设计稿「阅读来源与筛选」）：电脑第二栏和
// 手机「管理来源」抽屉共用。顶上「信息流」（行尾刷新全部来源：电脑上鼠标移上去才出，手机上常显）、「收藏」，下面「来源」
// 每种一行——色点、名字、行尾今天新来几条：兴趣、X、小红书、抖音收藏、Reddit、博客（Reddit 和博客加过才出）。点一行进这一种，
// 版块、站点在那一页顶上切。行尾的样子：没登录（电脑上看得到登录状态时）是「登录」小按钮，上次没取到是小红点（悬停看原因），
// 全暂停了是两竖、名字变淡。悬停（手机上一直）出 ⋯（feed-source-menu.tsx）。

import { useState, type ReactNode } from 'react';
import type { FeedNavResponse, FeedNavSource } from '../../api/shared.ts';
import { ColumnCount, ColumnLabel } from '../../shell/columns/column.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { openExternal } from '../../shell/open-external.ts';
import { SiteIcon } from '../../shell/site-icon.tsx';
import type { FeedSegment } from '../../state/feed-ui.ts';
import { KIND_HUES, kindGroups, kindOfSegment, type KindGroup } from './feed-kinds.ts';
import { isLoginKind, LOGIN_SITES, useSiteLogins, type LoginKind } from './feed-nav-data.ts';
import { useSourceActions } from './feed-source-actions.ts';
import { SourceMenu } from './feed-source-menu.tsx';
import { showFeedToast } from './feed-toast.tsx';
import './feed-sources.css';

/** Reddit 的圆标（橙底白字 r），卡片头、加来源对话框共用。 */
export function RedditMark({ size = 16 }: { size?: 16 | 20 | 28 }): ReactNode {
  return <span className="reddit-mark" data-size={size} aria-hidden="true">r</span>;
}

/** 一个来源前面的图标（设置弹层、加来源里用）：Reddit 圆标、博客的网站图标，别的是这一种的色点。 */
export function sourceLead(row: FeedNavSource): ReactNode {
  if (row.kind === 'reddit') {
    return <RedditMark />;
  }
  if (row.kind === 'rss') {
    return <SiteIcon url={row.source.query ?? ''} title={row.label} />;
  }
  return <KindDot kind={row.kind} />;
}

export function KindDot({ kind }: { kind: FeedNavSource['kind'] }): ReactNode {
  return <span className="feed-kind-dot" style={{ background: KIND_HUES[kind] }} aria-hidden="true" />;
}

/** 打开 X / 抖音 / 小红书的登录页（电脑上开成 Plasticine 的网页标签）。 */
export function openLogin(kind: LoginKind): void {
  openExternal(LOGIN_SITES[kind].url, LOGIN_SITES[kind].title);
}

export interface FeedSourceListProps {
  nav: FeedNavResponse | null;
  segment: FeedSegment;
  /** 主区正在看信息流列表（看着一条的时候不标当前行）。 */
  onList: boolean;
  onShow: (segment: FeedSegment) => void;
  onSettings: (row: FeedNavSource) => void;
  onDouyin: () => void;
  /** 加一个 Reddit 版块 / 博客（开「加来源」停在那一种上）。 */
  onAdd: (kind: 'reddit' | 'url') => void;
  /** 第一行的名字：阅读第二栏写「信息流」，手机抽屉写「全部」。 */
  allLabel?: string;
  /** 插在「收藏」和「来源」之间（阅读第二栏放图书馆）。 */
  between?: ReactNode;
}

export function FeedSourceList(props: FeedSourceListProps): ReactNode {
  const logins = useSiteLogins();
  const actions = useSourceActions();
  const [refreshing, setRefreshing] = useState(false);
  const current = (segment: FeedSegment): 'page' | undefined =>
    props.onList && props.segment === segment ? 'page' : undefined;
  const currentKind = props.onList ? kindOfSegment(props.segment, props.nav) : null;
  const groups = kindGroups(props.nav);
  const refreshAll = (): void => {
    if (props.nav === null || refreshing) return;
    setRefreshing(true);
    actions.refreshAll(props.nav.sources).then((result) => showFeedToast(result.text, result.failed),
      (cause: unknown) => showFeedToast(String(cause), true)).finally(() => setRefreshing(false));
  };
  return (
    <>
      <div className="feed-src feed-src-all" data-context-row="">
        <button type="button" className="column-item feed-src-main" aria-current={current('all')}
          onClick={() => props.onShow('all')}>
          <span className="column-item-lead"><Icon name="feed" size={16} /></span>
          <span className="column-item-text">{props.allLabel ?? '全部'}</span>
          <span className="column-item-trail feed-src-trail">
            {refreshing ? <StatusGlyph status="run" label="正在刷新" />
              : <ColumnCount value={props.nav?.all ?? null} label="条新的" />}</span>
        </button>
        <span className="feed-src-tools">
          <IconButton icon="refresh" className="feed-src-more feed-src-refresh" label="刷新全部来源" size={16}
            disabled={refreshing || props.nav === null} onClick={refreshAll} />
        </span>
      </div>
      <button type="button" className="column-item" aria-current={current('saved')}
        onClick={() => props.onShow('saved')}>
        <span className="column-item-lead"><Icon name="star" size={16} /></span>
        <span className="column-item-text">收藏</span>
      </button>
      {props.between}
      {props.nav === null ? null : <>
        <ColumnLabel>来源</ColumnLabel>
        <ul className="feed-srcs" aria-label="来源">
          {groups.map((group) => {
            const signedOut = logins !== null && isLoginKind(group.kind) && !logins[group.kind];
            return <KindRow key={group.kind} group={group} current={currentKind === group.kind ? 'page' : undefined}
              signedOut={signedOut} onShow={() => props.onShow(group.kind)} onSettings={props.onSettings}
              onDouyin={props.onDouyin} onAdd={props.onAdd} />;
          })}
        </ul>
      </>}
    </>
  );
}

function Trail({ group, busy, signedOut }: { group: KindGroup; busy: boolean; signedOut: boolean }): ReactNode {
  if (busy) {
    return <StatusGlyph status="run" label="正在刷新" />;
  }
  if (signedOut) {
    return null;
  }
  if (group.paused) {
    return <StatusGlyph status="pause" label="暂停了" />;
  }
  if (group.problem !== null) {
    return <span className="feed-src-dot" role="img" aria-label={`上次没取到：${group.problem}`}
      data-tip={group.problem} data-tip-side="right" data-tip-tap="" />;
  }
  return <ColumnCount value={group.count} label="条新的" />;
}

interface KindRowProps {
  group: KindGroup;
  current: 'page' | undefined;
  signedOut: boolean;
  onShow: () => void;
  onSettings: (row: FeedNavSource) => void;
  onDouyin: () => void;
  onAdd: (kind: 'reddit' | 'url') => void;
}

function KindRow({ group, current, signedOut, onShow, onSettings, onDouyin, onAdd }: KindRowProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const adds = group.kind === 'reddit' ? { label: '加版块…', onAdd: () => onAdd('reddit') }
    : group.kind === 'rss' ? { label: '加博客…', onAdd: () => onAdd('url') } : undefined;
  return (
    <li className="feed-src" data-paused={group.paused || undefined} data-login={signedOut || undefined}
      data-context-row="">
      <button type="button" className="column-item feed-src-main" aria-current={current} onClick={onShow}>
        <span className="column-item-lead"><KindDot kind={group.kind} /></span>
        <span className="column-item-text">{group.label}</span>
        <span className="column-item-trail feed-src-trail">
          <Trail group={group} busy={busy} signedOut={signedOut} />
        </span>
      </button>
      <span className="feed-src-tools">
        {signedOut && isLoginKind(group.kind) ? (
          <button type="button" className="feed-src-login" onClick={() => openLogin(group.kind as LoginKind)}
            aria-label={LOGIN_SITES[group.kind as LoginKind].login}>登录</button>
        ) : null}
        <SourceMenu rows={group.rows} label={`「${group.label}」的操作`} name={group.label}
          {...(adds === undefined ? {} : { add: adds })} onSettings={onSettings} onDouyin={onDouyin}
          onBusy={setBusy} />
      </span>
    </li>
  );
}
