// 工具浮层承载记账、文件和工具开关（2026-11-05 专注、自建日历和提醒删了）。浏览器走主栏路由。
// Sheet 遮罩只盖主区，对话栏照常可用（《UI 方案》第 9 节）。
// 各工具的内容按打开懒加载（用户视角审查 2026-11-01 第 16 条 ④），首包不带它们；等的时候是一句「正在读…」。

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
