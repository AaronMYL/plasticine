import type { ReactNode } from 'react';
import { cleanupRoute, layersMoveRoute, soulRoute, type Route } from '../../shell/routes.ts';
import { Icon } from '../../shell/icons.tsx';
import type { CleanupState } from './use-cleanup.ts';
import { useLayersMove } from './layers-move-page.tsx';
import { useRulesMove } from './use-rules-move.ts';
import './rules-move.css';
import { timeText } from '../../shell/time-text.ts';

export function CleanupButton({ cleanup, navigate, onError }: { cleanup: CleanupState;
  navigate: (route: Route) => void; onError: (problem: string | null) => void }): ReactNode {
  if (cleanup.data?.cleanup?.status === 'running') {
    return <span className="text-meta memory-cleanup-status" role="status">正在整理…</span>;
  }
  return <button type="button" className="secondary-button" onClick={() => {
    onError(null);
    void cleanup.start().then((problem) => {
      onError(problem);
      if (problem === null) navigate(cleanupRoute());
    });
  }}>全量整理</button>;
}

export function MemoryOverview({ cleanup, navigate, now = new Date(), children }:
  { cleanup: CleanupState; navigate: (route: Route) => void; now?: Date; children?: ReactNode }): ReactNode {
  const view = cleanup.data?.cleanup ?? null;
  const pending = view?.status === 'ready' ? view.items.filter((item) => item.applied === null).length : 0;
  const overview = cleanup.data?.overview ?? null;
  return (
    <section className="memory-overview" aria-label="总览">
      <div className="memory-overview-head">
        <h2 className="block-title">总览</h2>
        {overview === null ? null : <span className="text-meta">{timeText(overview.at, now)}整理</span>}
      </div>
      {overview === null || overview.text.trim() === '' ? null
        : <p className="memory-overview-text">{overview.text}</p>}
      {pending === 0 ? null : (
        <button type="button" className="topic-row memory-overview-list" onClick={() => navigate(cleanupRoute())}>
          <span className="topic-row-text"><span className="topic-row-title">整理清单 {pending} 条，等你勾选</span></span>
          <span className="topic-row-chevron" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
        </button>
      )}
      {children}
    </section>
  );
}

export function LayersMoveBanner({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const { move } = useLayersMove();
  const count = move?.items.length ?? 0;
  if (move === null || count === 0) {
    return null;
  }
  return (
    <div className="banner rules-move-banner" role="region" aria-label="记忆分层">
      <p className="banner-text rules-move-banner-text"><strong>记忆分好层了：搬了 {count} 条。</strong>
        原来混在「关于你」和旧约定里的，各回各处。</p>
      <button type="button" className="text-button" onClick={() => navigate(layersMoveRoute())}>看一下</button>
    </div>
  );
}

export function RulesMoveBanner({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const count = useRulesMove().data?.items.length ?? 0;
  if (count === 0) return null;
  return (
    <div className="banner rules-move-banner" role="region" aria-label="规则搬家">
      <p className="banner-text rules-move-banner-text"><strong>规则搬家：{count} 条等你勾。</strong>
        说话方式进各自的 Soul，你说过的偏好进「关于你」，硬线留在设置里。</p>
      <button type="button" className="text-button" onClick={() => navigate(soulRoute())}>去勾</button>
    </div>
  );
}
