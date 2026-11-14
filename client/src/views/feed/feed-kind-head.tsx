// 一种来源的页头（第13批，设计稿「阅读来源与筛选」）：名字旁边一个刷新（只刷新这一种），行尾 ⋯ 管这一种（选着一个版块、
// 博客时管那一个）；下面一排筛选——X 正在关注 / 为你推荐 / 书签，小红书推荐 / 收藏，Reddit 每个版块，博客每个站点，
// 默认全部，切换不跳页（只重读列表）。手机上不写名字（页头已经是「阅读」，名字在上面一排种类里），筛选一排横着滑、⋯ 在行尾。

import { useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import type { FeedNavSource } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import type { FeedSegment } from '../../state/feed-ui.ts';
import { kindChips, type KindGroup } from './feed-kinds.ts';
import { useSourceActions } from './feed-source-actions.ts';
import { SourceMenu } from './feed-source-menu.tsx';
import { showFeedToast } from './feed-toast.tsx';
import './feed-kinds.css';

export interface FeedKindHeadProps {
  group: KindGroup;
  segment: FeedSegment;
  /** 写不写名字（电脑上没有标题栏时写；桌面客户端名字在标题栏、手机在种类那一排）。 */
  titled: boolean;
  /** 刷新按钮在不在这里（手机上在页头）。 */
  refresh: boolean;
  onShow: (segment: FeedSegment) => void;
  onSettings: (row: FeedNavSource) => void;
  onDouyin: () => void;
  onAdd: (kind: 'reddit' | 'url') => void;
}

/** 刷新一种来源，完了在页面顶上浮一句。 */
export function useKindRefresh(group: KindGroup | null): { busy: boolean; run: () => void } {
  const actions = useSourceActions();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: () => {
      if (group === null || busy) return;
      setBusy(true);
      actions.refreshAll(group.rows, group.label).then((result) => showFeedToast(result.text, result.failed),
        (cause: unknown) => showFeedToast(errorText(cause), true)).finally(() => setBusy(false));
    },
  };
}

export function FeedKindHead(props: FeedKindHeadProps): ReactNode {
  const { group, segment } = props;
  const refresh = useKindRefresh(group);
  const chips = kindChips(group);
  const selected = chips.find((chip) => chip.segment === segment) ?? null;
  const own = selected?.row ?? null;
  const add = own !== null ? undefined : group.kind === 'reddit' ? { label: '加版块…', onAdd: () => props.onAdd('reddit') }
    : group.kind === 'rss' ? { label: '加博客…', onAdd: () => props.onAdd('url') } : undefined;
  const name = own?.label ?? group.label;
  const menu = <SourceMenu rows={own === null ? group.rows : [own]} label={`「${name}」的设置`} name={name}
    className="feed-kind-more" {...(add === undefined ? {} : { add })} onSettings={props.onSettings}
    onDouyin={props.onDouyin} afterRemove={group.rows.length > 1 ? group.kind : 'all'} />;
  const row = chips.length === 0 ? null : (
    <div className={`feed-chips${props.titled || props.refresh ? '' : ' feed-chips-scroll'}`} role="group"
      aria-label="看哪一处">
      {chips.map((chip) => (
        <button key={chip.segment} type="button" className="feed-chip" aria-pressed={chip.segment === segment}
          onClick={() => props.onShow(chip.segment)}>
          {chip.label}{chip.count === null || chip.count === 0 ? null
            : <span className="feed-chip-count">{chip.count}</span>}
        </button>
      ))}
    </div>
  );
  if (!props.titled && !props.refresh) {
    // 手机：名字在种类那一排、刷新在页头，这里只剩一排筛选，⋯ 跟在行尾；只有「全部」的（兴趣）整块不出，⋯ 在管理来源里。
    return row === null ? null : <div className="feed-kind-head is-compact">{row}{menu}</div>;
  }
  return (
    <div className="feed-kind-head">
      <div className="feed-kind-title">
        {props.titled ? <h2 className="feed-top-title">{group.label}</h2> : null}
        {props.refresh ? <IconButton icon="refresh" label={`刷新${name}`} size={16} disabled={refresh.busy}
          className="feed-kind-refresh" data-busy={refresh.busy || undefined} onClick={refresh.run} /> : null}
        <span className="feed-kind-gap" />
        {menu}
      </div>
      {row}
    </div>
  );
}
