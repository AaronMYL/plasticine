// 一期的几样字：「研究周报 · 第 2 期」「日报 · 11月7日」、日期、数字卡连成一行（「14 篇读过 · 5 篇重点」）。

import type { IssueBrief } from '../../api/shared.ts';

/** 第几期；个人回顾是来信（11-09 起）、旧版式是日报 / 周报。 */
export function issueLabel(issue: Pick<IssueBrief, 'edition' | 'issueNumber' | 'genre'>): string {
  if (issue.genre === 'letter') return '来信';
  if (issue.edition === 'daily') return '日报';
  if (issue.edition === 'weekly') return '周报';
  return `第 ${issue.issueNumber} 期`;
}

export function issueStats(issue: Pick<IssueBrief, 'stats'>): string {
  return issue.stats.map((stat) => `${stat.value} ${stat.label}`).join(' · ');
}


