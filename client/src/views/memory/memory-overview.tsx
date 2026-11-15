// 记忆首页的两块（11-11 记忆改版，设计稿「记忆首页」）：
// - 总览：最近一次全量整理写的一段话；有清单没看就是「整理清单 n 条」入口。总览里还挂着「说法冲突」「昨晚整理」两个入口，
//   连成一块，不在中间空一截。「全量整理」11-15 挪进页头那一行（界面统一，Aaron 弹框定「加回页头」），和搜索框在一起。
// - 规则搬家的提示条（第13批）：原来的「队友」一节（只对它的规则）去掉，规则还没搬完时在页面最上面提示。

import type { ReactNode } from 'react';
import { cleanupRoute, soulRoute, type Route } from '../../shell/routes.ts';
import { Icon } from '../../shell/icons.tsx';
import type { CleanupState } from './use-cleanup.ts';
import { useRulesMove } from './use-rules-move.ts';
import './rules-move.css';
import { timeText } from '../../shell/time-text.ts';

/** 页头的「全量整理」：正在整理时换成一句状态；开始不了的原因交给页面写在页头下面。 */
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

/**
 * 规则搬家的提示条（第13批设计稿 Memory）：「规则」里还有没搬的才出现，点「去勾」进规则搬家；都搬完了就没有了。
 * 原来这里是「队友」一节（点进去是只对它的规则），队友的规则并进各自的 Soul 以后去掉。
 */
export function RulesMoveBanner({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const count = useRulesMove().data?.items.length ?? 0;
  if (count === 0) return null;
  return (
    <div className="banner rules-move-banner" role="region" aria-label="规则搬家">
      <p className="banner-text rules-move-banner-text"><strong>规则搬家：{count} 条等你勾。</strong>
        说话方式进各自的 Soul，你说过的偏好进「关于你」，硬线和授权留在设置里。</p>
      <button type="button" className="text-button" onClick={() => navigate(soulRoute())}>去勾</button>
    </div>
  );
}
