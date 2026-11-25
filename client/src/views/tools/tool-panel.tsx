import { Suspense, type ReactNode } from 'react';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { lazyView } from '../../shell/lazy-view.ts';

const FilesView = lazyView<Record<never, never>>(() => import('./files-view.tsx'), 'FilesView');
const MoneyView = lazyView<{ entry?: { id: string; occurredAt: string } | undefined; date?: string | undefined }>(
  () => import('./money-view.tsx'), 'MoneyView');
const ToolGroupsView = lazyView<Record<never, never>>(() => import('./tool-groups-view.tsx'), 'ToolGroupsView');

interface ToolPanelProps {
  name: string; moneyEntry?: { id: string; occurredAt: string } | undefined;
  recordId?: string | undefined;
  moneyDate?: string | undefined;
  returnToCalendar?: boolean | undefined;
}

function ToolContent({ name, moneyEntry, moneyDate }: ToolPanelProps): ReactNode {
  switch (name) {
    case '记账':
      return <MoneyView entry={moneyEntry} date={moneyDate} />;
    case '文件':
      return <FilesView />;
    case '工具开关':
      return <ToolGroupsView />;
    default:
      return <p className="block-empty">没有「{name}」这一项。</p>;
  }
}

export function ToolPanel(props: ToolPanelProps): ReactNode {
  return <>
    <Suspense fallback={<PageLoading />}>
      <ToolContent {...props} />
    </Suspense>
  </>;
}
