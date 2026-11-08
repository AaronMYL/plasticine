// 工具整页（设计稿 2026-11-03）：对话里的工具卡「打开记账」、新标签页里的工具都在这里开成一个标签看全貌。
// 内容和原来浮层里的一样（tool-panel.tsx），只是放在页面里，有自己的标题。

import type { ReactNode } from 'react';
import { PageHeader } from '../../shell/page-header.tsx';
import type { ToolName } from '../../shell/routes.ts';
import { ToolPanel } from './tool-panel.tsx';

export function ToolPage({ tool }: { tool: ToolName | null }): ReactNode {
  if (tool === null) {
    return (
      <div className="page tool-page">
        <PageHeader title="工具" />
        <p className="block-empty">没有这个工具，工具都在新标签页里。</p>
      </div>
    );
  }
  return (
    <div className="page tool-page">
      <PageHeader title={tool} />
      <ToolPanel name={tool} />
    </div>
  );
}
