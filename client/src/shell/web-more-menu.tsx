// 网页工具条的 ⋯ 菜单（第 2 批「浏览器」，设计稿 Web-Menu / Phone-Web，他 11-04 定的顺序）：
//   在页面中查找 ⌘F · 缩放 − 100% +（按网站记住）· 阅读模式 ｜ 截图 ›（可见部分 / 整页，给 Plasticine 或存进笔记）·
//   存进笔记（整页剪藏，带来源）· 存成 PDF / 打印 ⌘P ｜ 复制链接 · 在浏览器打开 ｜ 下载 · 历史记录 ⌘Y ｜
//   导入登录…（第 3 批：Mac 会导入登录时才出，点了到设置 · 浏览器打开导入弹层）。
// 要原生做的项按原生报来的能力显示，没报的不显示（不置灰）；整节空了连分隔线一起不出。手机顶上多一排「书签 · 分组 ·
// 圈一块」，「在浏览器打开」写「在 Safari 打开」。「截图」点了换成第二页（← 截图），手机上也好按。

import { useState, type ReactNode } from 'react';
import type { WebPageToolName } from '../api/shared.ts';
import { zoomStep } from '../state/tabs-zoom.ts';
import { Icon, type IconName } from './icons.tsx';
import { MenuItem, MenuSeparator, Popover, type PopoverAnchor } from './popover.tsx';
import type { CaptureScope, CaptureTarget } from './web-page-actions.ts';

export interface WebMoreMenuProps {
  anchor: PopoverAnchor;
  phone: boolean;
  /** 有原生网页标签（Mac、iPhone App）：阅读模式、存进笔记、历史记录要读原生网页的正文和地址。 */
  native: boolean;
  tools: ReadonlySet<WebPageToolName>;
  zoom: number;
  reading: boolean;
  onFind: () => void;
  onZoom: (factor: number) => void;
  onReading: () => void;
  onCapture: (scope: CaptureScope, target: CaptureTarget) => void;
  onClip: () => void;
  onPrint: () => void;
  onCopyLink: () => void;
  onOpenOutside: () => void;
  onDownloads: () => void;
  /** 手机上历史记录在这张菜单里；电脑上在工具栏，不给。 */
  onHistory?: ((anchor: PopoverAnchor) => void) | undefined;
  /** 第 3 批：Mac 会导入登录（webTabs 之外的 logins 桥）才给；不给就不出这一项。 */
  onImportLogins?: () => void;
  /** 手机顶上那一排。 */
  onBookmarks?: (anchor: PopoverAnchor) => void;
  onGroups?: (anchor: PopoverAnchor) => void;
  onCircle?: () => void;
  onClose: () => void;
}

function sections(parts: ReactNode[][]): ReactNode[] {
  return parts.filter((part) => part.length > 0)
    .flatMap((part, index) => (index === 0 ? part : [<MenuSeparator key={`separator-${index}`} />, ...part]));
}

function Quick({ icon, label, onSelect }: { icon: IconName; label: string; onSelect: () => void }): ReactNode {
  return (
    <button type="button" role="menuitem" className="web-quick" onClick={onSelect}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}

function ZoomRow({ zoom, onZoom }: { zoom: number; onZoom: (factor: number) => void }): ReactNode {
  return (
    <div className="web-zoom-row">
      <Icon name="expand" size={15} />
      <span className="popover-item-label">缩放</span>
      <span className="web-zoom" role="group" aria-label="缩放">
        <button type="button" role="menuitem" aria-label="缩小" onClick={() => onZoom(zoomStep(zoom, -1))}>−</button>
        <button type="button" role="menuitem" className="web-zoom-value" aria-label={`恢复 100%，现在 ${Math.round(
          zoom * 100)}%`} onClick={() => onZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" role="menuitem" aria-label="放大" onClick={() => onZoom(zoomStep(zoom, 1))}>+</button>
      </span>
    </div>
  );
}

function CapturePage({ full, onBack, onCapture }: { full: boolean; onBack: () => void;
  onCapture: (scope: CaptureScope, target: CaptureTarget) => void }): ReactNode {
  const row = (scope: CaptureScope, label: string): ReactNode => (
    <div className="web-capture-row" role="group" aria-label={label}>
      <span className="popover-item-label">{label}</span>
      <button type="button" role="menuitem" className="web-capture-action" aria-label={`${label}给 Plasticine`}
        onClick={() => onCapture(scope, 'plasticine')}>给 Plasticine</button>
      <button type="button" role="menuitem" className="web-capture-action" aria-label={`${label}存进笔记`}
        onClick={() => onCapture(scope, 'note')}>存进笔记</button>
    </div>
  );
  return (
    <>
      <button type="button" role="menuitem" className="popover-item web-menu-back" onClick={onBack}>
        <Icon name="back" size={14} />
        <span className="popover-item-label">截图</span>
      </button>
      <MenuSeparator />
      {row('visible', '可见部分')}
      {full ? row('full', '整页') : null}
    </>
  );
}

export function WebMoreMenu(props: WebMoreMenuProps): ReactNode {
  const [page, setPage] = useState<'main' | 'capture'>('main');
  const { tools } = props;
  const run = (action: () => void) => (): void => {
    props.onClose();
    action();
  };
  if (page === 'capture') {
    return (
      <Popover anchor={props.anchor} role="menu" align="end" label="截图"
        className={props.phone ? 'web-menu web-menu-phone' : 'web-menu'} onClose={props.onClose}>
        <CapturePage full={tools.has('capture_full')} onBack={() => setPage('main')}
          onCapture={(scope, target) => run(() => props.onCapture(scope, target))()} />
      </Popover>
    );
  }
  const quick: ReactNode[] = !props.phone ? [] : [
    <div key="quick" className="web-quick-row" role="group" aria-label="常用">
      {props.onBookmarks === undefined ? null : <Quick icon="bookmark" label="书签"
        onSelect={() => props.onBookmarks?.(props.anchor)} />}
      {props.onGroups === undefined ? null : <Quick icon="tabs" label="分组"
        onSelect={() => props.onGroups?.(props.anchor)} />}
      {props.onCircle === undefined || !tools.has('circle') ? null : <Quick icon="region" label="圈一块"
        onSelect={run(props.onCircle)} />}
    </div>,
  ];
  const view: ReactNode[] = [
    tools.has('find') ? <MenuItem key="find" icon="search" label="在页面中查找" shortcut={props.phone ? undefined : '⌘F'}
      onSelect={run(props.onFind)} /> : null,
    tools.has('zoom') ? <ZoomRow key="zoom" zoom={props.zoom} onZoom={props.onZoom} /> : null,
    props.native ? <MenuItem key="reader" icon="toc" label="阅读模式" checked={props.reading}
      onSelect={run(props.onReading)} /> : null,
  ].filter((item) => item !== null);
  const keep: ReactNode[] = [
    tools.has('capture') ? <MenuItem key="capture" icon="image" label="截图" more
      onSelect={() => setPage('capture')} /> : null,
    props.native ? <MenuItem key="clip" icon="notes" label="存进笔记" onSelect={run(props.onClip)} /> : null,
    tools.has('print') ? <MenuItem key="print" icon="file" label="存成 PDF / 打印" shortcut={props.phone ? undefined : '⌘P'}
      onSelect={run(props.onPrint)} /> : null,
  ].filter((item) => item !== null);
  const share: ReactNode[] = [
    <MenuItem key="copy" icon="link" label="复制链接" onSelect={run(props.onCopyLink)} />,
    <MenuItem key="outside" icon="external" label={props.phone ? '在 Safari 打开' : '在浏览器打开'}
      onSelect={run(props.onOpenOutside)} />,
  ];
  const records: ReactNode[] = [
    tools.has('downloads') ? <MenuItem key="downloads" icon="download" label="下载"
      onSelect={run(props.onDownloads)} /> : null,
    props.native && props.onHistory !== undefined ? <MenuItem key="history" icon="history" label="历史记录"
      onSelect={() => props.onHistory?.(props.anchor)} /> : null,
  ].filter((item) => item !== null);
  const logins: ReactNode[] = props.onImportLogins === undefined ? [] : [
    <MenuItem key="import" icon="lock" label="导入登录…" onSelect={run(props.onImportLogins)} />,
  ];
  return (
    <Popover anchor={props.anchor} role="menu" align="end" label="更多"
      className={props.phone ? 'web-menu web-menu-phone' : 'web-menu'} onClose={props.onClose}>
      {quick}
      {sections([view, keep, share, records, logins])}
    </Popover>
  );
}
