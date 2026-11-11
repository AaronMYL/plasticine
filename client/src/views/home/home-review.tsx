// 首页的回顾（《优化清单》第 7 条；11-11 第 11 批并进「新的」）：个人回顾不进信息流，摘要放在这里——最近一期日报 / 周报的
// 一句（点开那一期空间），昨晚整理了几条记忆（点开「昨晚整理了什么」）。两样都没有就不出这两行。

import { useCallback, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { ReviewSummary } from '../../api/shared.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useTabActions } from '../../shell/tabs-context.ts';
import { useRead } from '../memory/use-read.ts';
import { issueLabel } from '../spaces/issue-text.ts';
import { spaceRoute } from '../spaces/space-links.ts';

/** 最近一期个人回顾和昨晚整理的记忆（「新的」里的两行）；读到前和都没有时是 null。 */
export function useHomeReview(): ReviewSummary | null {
  const api = useApi();
  const read = useCallback((signal: AbortSignal) => api.subscriptions.review(signal), [api]);
  const { value } = useRead(read);
  if (value === null || (value.latest === null && value.dream === null)) {
    return null;
  }
  return value;
}

/** 「新的」里的回顾两行：报告一句、昨晚整理了几条。 */
export function ReviewRows({ value }: { value: ReviewSummary }): ReactNode {
  const tabs = useTabActions();
  const { latest, dream } = value;
  const counts = dream === null ? '' : [['新加', dream.add], ['替换', dream.replace], ['拿不准', dream.unsure]]
    .filter(([, count]) => Number(count) > 0).map(([label, count]) => `${label} ${count}`).join(' · ');
  return (
    <>
      {latest === null ? null : <li>
        <button type="button" className="home-row-line home-review-row"
          onClick={() => tabs.openTab(spaceRoute(latest.spaceId), latest.title)}>
          <AiMark />
          <span className="home-review-title">{issueLabel(latest)}：{latest.headline}</span>
          <Icon name="chevron-right" size={14} />
        </button>
      </li>}
      {dream === null ? null : <li>
        <button type="button" className="home-row-line home-review-row"
          onClick={() => tabs.openTab({ view: 'memory', noteId: null, memoryDream: true }, '昨晚整理了什么')}>
          <AiMark />
          <span className="home-review-title">昨晚整理了 {dream.total} 条记忆
            {counts === '' ? null : <span className="home-review-meta">{counts}</span>}</span>
          <Icon name="chevron-right" size={14} />
        </button>
      </li>}
    </>
  );
}
