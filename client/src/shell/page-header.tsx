import type { ReactNode } from 'react';
import { IconButton } from './icon-button.tsx';
import { useOpenPanel } from './panel.ts';
import { TitlebarTitle, useInTitlebar } from './titlebar.tsx';
import { useRoute } from './use-route.ts';
import { PHONE_BELOW } from './layout.ts';
import { useViewportWidth } from './use-viewport-width.ts';

export interface PageHeaderProps {
  title: string;
  count?: number | undefined;
  controls?: ReactNode;
  phoneTools?: ReactNode;
  phoneSearch?: boolean;
  onBack?: (() => void) | undefined;
}

export function PageHeader({ title, count, controls, phoneTools, phoneSearch = true, onBack }: PageHeaderProps)
  : ReactNode {
  const openPanel = useOpenPanel();
  const { canGoBack, goBack } = useRoute();
  const phone = useViewportWidth() < PHONE_BELOW;
  const titled = useInTitlebar() && !phone;
  if (titled && controls === undefined) {
    return <><TitlebarTitle text={title} count={count} /><h1 className="sr-only">{title}</h1></>;
  }
  return (
    <header className="page-head">
      {titled ? <TitlebarTitle text={title} count={count} /> : null}
      <div className="page-head-title">
        {phone && onBack !== undefined ? <IconButton icon="back" label="回到上一层" className="page-back" onClick={onBack} />
          : canGoBack && phone ? <IconButton icon="back" label="回到上一页" className="page-back" onClick={goBack} />
            : null}
        <h1 className={titled ? 'sr-only' : undefined}>{title}</h1>
        {count === undefined || titled ? null : <span className="page-head-status">{count}</span>}
      </div>
      {controls === undefined ? null : <div className="page-head-controls">{controls}</div>}
      {phone && (phoneSearch || phoneTools !== undefined) ? (
        <div className="page-head-tools">
          {phoneSearch ? <IconButton icon="search" label="查找内容" size={20}
            onClick={() => openPanel({ kind: 'search' })} /> : null}
          {phoneTools}
        </div>
      ) : null}
    </header>
  );
}
