// 一期的几样字：「研究周报 · 第 2 期」「日报 · 11月7日」、日期、数字卡连成一行（「14 篇读过 · 5 篇重点」）。

import type { IssueBrief } from '../../api/shared.ts';

export function issueDate(issue: Pick<IssueBrief, 'createdAt'>, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric',
    ...(timeZone === undefined ? {} : { timeZone }) }).formatToParts(new Date(issue.createdAt));
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('month')}月${value('day')}日`;
}

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

// 三天内出的算「新」（设计稿 Feed：研究周报 · 第 2 期 · 新）。
const FRESH_MS = 3 * 24 * 60 * 60 * 1000;

export function isFresh(issue: Pick<IssueBrief, 'createdAt'>, now: Date): boolean {
  return now.getTime() - Date.parse(issue.createdAt) <= FRESH_MS;
}
