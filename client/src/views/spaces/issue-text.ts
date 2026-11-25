import type { IssueBrief } from '../../api/shared.ts';

export function issueLabel(issue: Pick<IssueBrief, 'edition' | 'issueNumber' | 'genre'>): string {
  if (issue.genre === 'letter') return '来信';
  if (issue.edition === 'daily') return '日报';
  if (issue.edition === 'weekly') return '周报';
  return `第 ${issue.issueNumber} 期`;
}

export function issueStats(issue: Pick<IssueBrief, 'stats'>): string {
  return issue.stats.map((stat) => `${stat.value} ${stat.label}`).join(' · ');
}

