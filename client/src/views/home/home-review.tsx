import { useCallback, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { ReviewSummary } from '../../api/shared.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useTabActions } from '../../shell/tabs-context.ts';
import { useRead } from '../memory/use-read.ts';
import { issueLabel } from '../spaces/issue-text.ts';
import { spaceRoute } from '../spaces/space-links.ts';

export function useHomeReview(): ReviewSummary | null {
  const api = useApi();
  const read = useCallback((signal: AbortSignal) => api.subscriptions.review(signal), [api]);
  const { value } = useRead(read);
  if (value === null || (value.latest === null && value.dream === null)) {
    return null;
  }
  return value;
}

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
