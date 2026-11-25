import { MAIN_THREAD_PATH, reportBrief } from '../../shared/api/index.ts';
import type { LineReportMessage } from '../lines/index.ts';

export function reportAnnouncement(report: LineReportMessage): { body: string; url: string; tag: string } | null {
  const body = reportBrief(report.unmet === undefined ? report.outcome : 'unmet');
  return body === null ? null
    : { body, url: MAIN_THREAD_PATH, tag: `line-report:${report.lineId}:${report.timestamp}` };
}
