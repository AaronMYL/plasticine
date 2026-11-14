// 一个来源（或一种来源）的 ⋯（第 7 批第 10 条；第13批第二栏按种类合成一行后，第二栏和来源页标题旁共用）：
// 一个来源：现在刷新 / 设置… / 暂停或继续 / 删除（内置的没有删除，删除先问一句、写清后果）；抖音收藏多一项「选收藏…」。
// 一种（Reddit、博客合成的那一行、来源页选着「全部」时）：刷新这一种 / 加版块… 或 加博客…。刷新完页面顶上浮一句。

import { useRef, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { FEED_BUILT_IN_NAV_KINDS, type FeedNavSource } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { anchorOf, MenuItem, MenuSeparator, Popover, type PopoverAnchor } from '../../shell/popover.tsx';
import type { FeedSegment } from '../../state/feed-ui.ts';
import { useSourceActions } from './feed-source-actions.ts';
import { showFeedToast } from './feed-toast.tsx';

type Open = { kind: 'menu' | 'confirm'; anchor: PopoverAnchor } | null;

export interface SourceMenuProps {
  /** 一个来源：管它；一种（rows 多于一个或 add 给了）：刷新这一种、加一个。 */
  rows: readonly FeedNavSource[];
  /** 菜单的名字（「「X」的操作」）。 */
  label: string;
  /** 这一种的名字（刷新完那句话里用）。 */
  name: string;
  /** 加一个版块 / 博客（只在一种的菜单里）。 */
  add?: { label: string; onAdd: () => void };
  onSettings: (row: FeedNavSource) => void;
  onDouyin: () => void;
  /** 正在刷新（行尾转圈）。 */
  onBusy?: (busy: boolean) => void;
  /** 删掉正看着的这一个以后看哪里（默认信息流）。 */
  afterRemove?: FeedSegment;
  className?: string;
}

export function SourceMenu({ rows, label, name, add, onSettings, onDouyin, onBusy, afterRemove, className }:
  SourceMenuProps): ReactNode {
  const actions = useSourceActions();
  const more = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const row = add === undefined && rows.length === 1 ? rows[0]! : null;
  const run = (work: () => Promise<void>): void => {
    setBusy(true);
    onBusy?.(true);
    work().catch((cause: unknown) => showFeedToast(errorText(cause), true)).finally(() => {
      setBusy(false);
      onBusy?.(false);
    });
  };
  const refresh = (): void => run(async () => {
    const result = await actions.refreshAll(rows, name);
    showFeedToast(result.text, result.failed);
  });
  const close = (): void => setOpen(null);
  const toggle = (): void => {
    if (open !== null) close();
    else if (more.current !== null) setOpen({ kind: 'menu', anchor: anchorOf(more.current) });
  };
  const paused = row?.source.level === 'off';
  const deletable = row !== null && !FEED_BUILT_IN_NAV_KINDS.includes(row.kind);
  return <>
    <IconButton ref={more} icon="more" className={className ?? 'feed-src-more'} label={label} size={16}
      data-row-menu="" aria-haspopup="menu" aria-expanded={open !== null} onClick={toggle} />
    {open?.kind === 'menu' ? (
      <Popover anchor={open.anchor} label={label} role="menu" align="start" trigger={more} onClose={close}
        className="feed-src-menu">
        <MenuItem icon="refresh" label={row?.kind === 'douyin' ? '现在同步' : '现在刷新'} disabled={busy}
          onSelect={() => {
            close();
            refresh();
          }} />
        {add === undefined ? null : <MenuItem icon="plus" label={add.label} onSelect={() => {
          close();
          add.onAdd();
        }} />}
        {row?.kind === 'douyin' ? <MenuItem icon="check" label="选收藏…" onSelect={() => {
          close();
          onDouyin();
        }} /> : null}
        {row === null ? null : <MenuItem icon="sliders" label="设置…" onSelect={() => {
          close();
          onSettings(row);
        }} />}
        {row === null || row.kind === 'douyin' ? null : <MenuItem icon={paused ? 'play' : 'pause'}
          label={paused ? '继续' : '暂停'} onSelect={() => {
            close();
            run(() => actions.pause(row, !paused));
          }} />}
        {deletable ? <>
          <MenuSeparator />
          <MenuItem icon="trash" label="删除" onSelect={() => setOpen({ kind: 'confirm', anchor: open.anchor })} />
        </> : null}
      </Popover>
    ) : null}
    {open?.kind === 'confirm' && row !== null ? (
      <Popover anchor={open.anchor} label={`删除「${row.label}」`} role="dialog" align="start" trigger={more}
        onClose={close} initialFocus="first" className="feed-src-confirm">
        <p className="feed-src-confirm-title">删除「{row.label}」？</p>
        <p className="feed-src-confirm-text">不再抓取；它带来的条目从信息流移除，收藏过的留在「收藏」里。</p>
        <div className="feed-src-confirm-actions">
          <button type="button" className="secondary-button button-small" onClick={close}>取消</button>
          <button type="button" className="secondary-button button-small feed-danger" onClick={() => {
            close();
            run(() => actions.remove(row, afterRemove));
          }}>删除</button>
        </div>
      </Popover>
    ) : null}
  </>;
}
