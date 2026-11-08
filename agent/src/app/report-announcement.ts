// 后台线贴回主线的结果，系统通知里那一句（《优化清单》第 12 条；11-07 他定只在没做成时弹：做成的只在主线上贴结果）。
// 只说没做成还是没做完，不带线的标题和结果正文（第 91 条：推送只写一句话和链接）；点开到和 Plasticine 的对话。
// Mac App 用同一句（shared/api/push.ts 的 reportBrief）。

import { MAIN_THREAD_PATH, reportBrief } from '../../shared/api/index.ts';
import type { LineReportMessage } from '../lines/index.ts';

export function reportAnnouncement(report: LineReportMessage): { body: string; url: string; tag: string } | null {
  const body = reportBrief(report.unmet === undefined ? report.outcome : 'unmet');
  return body === null ? null
    : { body, url: MAIN_THREAD_PATH, tag: `line-report:${report.lineId}:${report.timestamp}` };
}
