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
