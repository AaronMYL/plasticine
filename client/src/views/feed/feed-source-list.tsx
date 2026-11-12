// 信息流的来源列表（第 7 批第 10 条，设计稿 Feed-Sources）：电脑第二栏和手机「筛选」抽屉共用。顶上「全部」「收藏」，
// 下面「来源」每个来源一行——图标（X 井号、抖音播放、新闻地球、Reddit 圆标、订阅用网站图标）、名字、行尾今天新来几条。
// 点一行只看这一个来源。行尾的样子：没登录（电脑上看得到登录状态时）是「登录」小按钮，上次没取到是小红点（悬停看
// 原因），暂停了是两竖、名字变淡。悬停（手机上一直）出 ⋯：现在刷新 / 设置… / 暂停或继续 / 删除（内置的三种没有删除，
// 删除先问一句、写清后果）。抖音收藏的 ⋯ 里多一项「选收藏…」开勾选清单。

import { useRef, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { FEED_BUILT_IN_NAV_KINDS, type FeedNavResponse, type FeedNavSource } from '../../api/shared.ts';
import { ColumnCount, ColumnLabel } from '../../shell/columns/column.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { openExternal } from '../../shell/open-external.ts';
import { anchorOf, MenuItem, MenuSeparator, Popover, type PopoverAnchor } from '../../shell/popover.tsx';
import { SiteIcon } from '../../shell/site-icon.tsx';
import { sourceSegment, type FeedSegment } from '../../state/feed-ui.ts';
import { isLoginKind, LOGIN_SITES, useSiteLogins, type LoginKind } from './feed-nav-data.ts';
import { useSourceActions } from './feed-source-actions.ts';
import './feed-sources.css';

const KIND_ICONS: Readonly<Record<'x' | 'douyin' | 'news', IconName>> = { x: 'hash', douyin: 'play', news: 'globe' };

/** Reddit 的圆标（橙底白字 r），第二栏、卡片头、加来源对话框共用。 */
export function RedditMark({ size = 16 }: { size?: 16 | 20 | 28 }): ReactNode {
  return <span className="reddit-mark" data-size={size} aria-hidden="true">r</span>;
}

export function sourceLead(row: FeedNavSource): ReactNode {
  if (row.kind === 'reddit') {
    return <RedditMark />;
  }
  if (row.kind === 'rss') {
    return <SiteIcon url={row.source.query ?? ''} title={row.label} />;
  }
  return <Icon name={KIND_ICONS[row.kind]} size={16} />;
}

/** 打开 X / 抖音的登录页（电脑上开成 Plasticine 的网页标签）。 */
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
  /** 第一行的名字：阅读第二栏写「信息流」，手机筛选抽屉写「全部」。 */
  allLabel?: string;
  /** 插在「收藏」和「来源」之间（阅读第二栏放图书馆）。 */
  between?: ReactNode;
}

export function FeedSourceList(props: FeedSourceListProps): ReactNode {
  const logins = useSiteLogins();
  const current = (segment: FeedSegment): 'page' | undefined =>
    props.onList && props.segment === segment ? 'page' : undefined;
  return (
    <>
      <button type="button" className="column-item" aria-current={current('all')} onClick={() => props.onShow('all')}>
        <span className="column-item-lead"><Icon name="feed" size={16} /></span>
        <span className="column-item-text">{props.allLabel ?? '全部'}</span>
        <span className="column-item-trail"><ColumnCount value={props.nav?.all ?? null} label="条新的" /></span>
      </button>
      <button type="button" className="column-item" aria-current={current('saved')}
        onClick={() => props.onShow('saved')}>
        <span className="column-item-lead"><Icon name="star" size={16} /></span>
        <span className="column-item-text">收藏</span>
      </button>
      {props.between}
      {props.nav === null ? null : <>
        <ColumnLabel>来源</ColumnLabel>
        <ul className="feed-srcs" aria-label="来源">
          {props.nav.sources.map((row) => {
            const segment = row.kind === 'rss' || row.kind === 'reddit' ? sourceSegment(row.source.id) : row.kind;
            const signedOut = logins !== null && isLoginKind(row.kind) && !logins[row.kind];
            return <SourceRow key={row.source.id} row={row} current={current(segment)} signedOut={signedOut}
              onShow={() => props.onShow(segment)} onSettings={() => props.onSettings(row)}
              onDouyin={props.onDouyin} />;
          })}
        </ul>
      </>}
    </>
  );
}

interface SourceRowProps {
  row: FeedNavSource;
  current: 'page' | undefined;
  signedOut: boolean;
  onShow: () => void;
  onSettings: () => void;
  onDouyin: () => void;
}

type Open = { kind: 'menu' | 'confirm'; anchor: PopoverAnchor } | null;

function Trail({ row, busy, signedOut }: { row: FeedNavSource; busy: boolean; signedOut: boolean }): ReactNode {
  if (busy) {
    return <StatusGlyph status="run" label="正在刷新" />;
  }
  if (signedOut) {
    return null;
  }
  if (row.source.level === 'off') {
    return <StatusGlyph status="pause" label="暂停了" />;
  }
  if (row.problem !== null) {
    return <span className="feed-src-dot" role="img" aria-label={`上次没取到：${row.problem}`}
      data-tip={row.problem} data-tip-side="right" data-tip-tap="" />;
  }
  return <ColumnCount value={row.count} label="条新的" />;
}

function SourceRow({ row, current, signedOut, onShow, onSettings, onDouyin }: SourceRowProps): ReactNode {
  const actions = useSourceActions();
  const more = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = row.source.level === 'off';
  const deletable = !FEED_BUILT_IN_NAV_KINDS.includes(row.kind);
  const run = (work: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    work().catch((cause: unknown) => setError(errorText(cause))).finally(() => setBusy(false));
  };
  const close = (): void => setOpen(null);
  const toggle = (): void => {
    if (open !== null) {
      close();
    } else if (more.current !== null) {
      setOpen({ kind: 'menu', anchor: anchorOf(more.current) });
    }
  };
  const menuLabel = `「${row.label}」的操作`;
  return (
    <li className="feed-src" data-paused={paused || undefined} data-open={open !== null || undefined}
      data-login={signedOut || undefined} data-context-row="">
      <button type="button" className="column-item feed-src-main" aria-current={current} onClick={onShow}>
        <span className="column-item-lead">{sourceLead(row)}</span>
        <span className="column-item-text">{row.label}</span>
        <span className="column-item-trail feed-src-trail"><Trail row={row} busy={busy} signedOut={signedOut} /></span>
      </button>
      <span className="feed-src-tools">
        {signedOut && isLoginKind(row.kind) ? (
          <button type="button" className="feed-src-login" onClick={() => openLogin(row.kind as LoginKind)}
            aria-label={LOGIN_SITES[row.kind as LoginKind].login}>登录</button>
        ) : null}
        <IconButton ref={more} icon="more" className="feed-src-more" label={menuLabel} size={16} data-row-menu=""
          aria-haspopup="menu" aria-expanded={open !== null} onClick={toggle} />
      </span>
      {error === null ? null : <p className="feed-src-error" role="alert">{error}</p>}
      {open?.kind === 'menu' ? (
        <Popover anchor={open.anchor} label={menuLabel} role="menu" align="start" trigger={more} onClose={close}
          className="feed-src-menu">
          <MenuItem icon="refresh" label={row.kind === 'douyin' ? '现在同步' : '现在刷新'} disabled={busy}
            onSelect={() => {
              close();
              run(() => actions.refresh(row));
            }} />
          {row.kind === 'douyin' ? <MenuItem icon="check" label="选收藏…" onSelect={() => {
            close();
            onDouyin();
          }} /> : null}
          <MenuItem icon="sliders" label="设置…" onSelect={() => {
            close();
            onSettings();
          }} />
          {row.kind === 'douyin' ? null : <MenuItem icon={paused ? 'play' : 'pause'} label={paused ? '继续' : '暂停'}
            onSelect={() => {
              close();
              run(() => actions.pause(row, !paused));
            }} />}
          {deletable ? <>
            <MenuSeparator />
            <MenuItem icon="trash" label="删除" onSelect={() => setOpen({ kind: 'confirm', anchor: open.anchor })} />
          </> : null}
        </Popover>
      ) : null}
      {open?.kind === 'confirm' ? (
        <Popover anchor={open.anchor} label={`删除「${row.label}」`} role="dialog" align="start" trigger={more}
          onClose={close} initialFocus="first" className="feed-src-confirm">
          <p className="feed-src-confirm-title">删除「{row.label}」？</p>
          <p className="feed-src-confirm-text">不再抓取；它带来的条目从信息流移除，收藏过的留在「收藏」里。</p>
          <div className="feed-src-confirm-actions">
            <button type="button" className="secondary-button button-small" onClick={close}>取消</button>
            <button type="button" className="secondary-button button-small feed-danger" onClick={() => {
              close();
              run(() => actions.remove(row));
            }}>删除</button>
          </div>
        </Popover>
      ) : null}
    </li>
  );
}
