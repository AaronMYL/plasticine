import { useRef, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { FEED_BUILT_IN_NAV_KINDS, type FeedNavSource } from '../../api/shared.ts';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { anchorOf, MenuItem, MenuSeparator, Popover, type PopoverAnchor } from '../../shell/popover.tsx';
import type { FeedSegment } from '../../state/feed-ui.ts';
import { useSourceActions } from './feed-source-actions.ts';
import { showResultToast } from '../../primitives/toast/index.tsx';

type Open = { kind: 'menu' | 'confirm'; anchor: PopoverAnchor } | null;

export interface SourceMenuProps {
  rows: readonly FeedNavSource[];
  label: string;
  name: string;
  add?: { label: string; onAdd: () => void };
  onSettings: (row: FeedNavSource) => void;
  onDouyin: () => void;
  onBusy?: (busy: boolean) => void;
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
    work().catch((cause: unknown) => showResultToast(errorText(cause), true)).finally(() => {
      setBusy(false);
      onBusy?.(false);
    });
  };
  const refresh = (): void => run(async () => {
    const result = await actions.refreshAll(rows, name);
    showResultToast(result.text, result.failed);
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
      <ConfirmDialog title={`删除「${row.label}」？`} confirmLabel="删除" onCancel={close}
        body="不再抓取；它带来的条目从信息流移除，收藏过的留在「收藏」里。" onConfirm={() => {
          close();
          run(() => actions.remove(row, afterRemove));
        }} />
    ) : null}
  </>;
}
