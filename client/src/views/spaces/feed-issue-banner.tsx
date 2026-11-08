// 信息流顶部的「订阅」（第 6 条，设计稿 Feed）：最新一期研究周报只放摘要、封面和几个重点——期号、结论一句、数字卡，
// 「打开」进空间；「订阅」开那个订阅的最新一期 / 往期 / 设置。没有研究订阅或还没出过一期就整条不出现。

import { useCallback, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { useTabActions } from '../../shell/tabs-context.ts';
import { useRead } from '../memory/use-read.ts';
import { isFresh, issueStats } from './issue-text.ts';
import { spaceRoute } from './space-links.ts';
import { SubscriptionSheet } from './subscription-sheet.tsx';
import './spaces.css';

export function FeedIssueBanner({ phone, now = new Date() }: { phone: boolean; now?: Date }): ReactNode {
  const api = useApi();
  const tabs = useTabActions();
  const read = useCallback((signal: AbortSignal) => api.subscriptions.list(signal), [api]);
  const { value } = useRead(read);
  const [sheet, setSheet] = useState(false);
  const latest = (value?.subscriptions ?? []).filter((sub) => sub.kind === 'research' && sub.latest !== null)
    .map((sub) => ({ sub, issue: sub.latest! }))
    .sort((a, b) => b.issue.createdAt.localeCompare(a.issue.createdAt))[0];
  if (latest === undefined) {
    return null;
  }
  const { sub, issue } = latest;
  const open = (id: string): void => tabs.openTab(spaceRoute(id), issue.title);
  return (
    <section className="feed-issue" aria-label="订阅">
      <button type="button" className="feed-issue-main" onClick={() => open(issue.spaceId)}>
        <HueTile hue="sky" icon="chart" size={36} />
        <span className="feed-issue-text">
          <span className="text-meta">{`${issue.title}${isFresh(issue, now) ? ' · 新' : ''}`}</span>
          <span className="feed-issue-headline">{issue.headline}</span>
          {issue.stats.length === 0 ? null : <span className="text-meta">{issueStats(issue)}</span>}
        </span>
      </button>
      <button type="button" className="text-button text-button-quiet" aria-haspopup="dialog"
        onClick={() => setSheet(true)}>订阅</button>
      <button type="button" className="secondary-button" onClick={() => open(issue.spaceId)}>打开</button>
      <SubscriptionSheet open={sheet} subscriptionId={sub.id} phone={phone} initialTab="latest"
        onClose={() => setSheet(false)} onOpenIssue={(id) => {
          setSheet(false);
          open(id);
        }} />
    </section>
  );
}
