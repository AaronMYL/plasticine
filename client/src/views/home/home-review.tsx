// 首页「现在」的「回顾」（《优化清单》第 7 条，设计稿 Main）：个人回顾不进信息流，摘要放在这里——最近一期日报 / 周报的
// 一句（点开那一期空间），昨晚整理了几条记忆（点开「昨晚整理了什么」）。两样都没有就整节不出现。

import { useCallback, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { AiMark } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useTabActions } from '../../shell/tabs-context.ts';
import { useRead } from '../memory/use-read.ts';
import { issueLabel } from '../spaces/issue-text.ts';
import { spaceRoute } from '../spaces/space-links.ts';

export function HomeReview(): ReactNode {
  const api = useApi();
  const tabs = useTabActions();
  const read = useCallback((signal: AbortSignal) => api.subscriptions.review(signal), [api]);
  const { value } = useRead(read);
  if (value === null || (value.latest === null && value.dream === null)) {
    return null;
  }
  const { latest, dream } = value;
  const counts = dream === null ? '' : [['新加', dream.add], ['替换', dream.replace], ['拿不准', dream.unsure]]
    .filter(([, count]) => Number(count) > 0).map(([label, count]) => `${label} ${count}`).join(' · ');
  return (
    <section className="home-section" aria-label="回顾">
      <h2 className="home-section-title">回顾</h2>
      <ul className="home-list">
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
      </ul>
    </section>
  );
}
