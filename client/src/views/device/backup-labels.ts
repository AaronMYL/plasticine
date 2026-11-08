import { TERM_TIER_LABELS, type BackupObjectKind } from '../../api/shared.ts';
export const BACKUP_KIND: Record<BackupObjectKind, string> = {
  note: '笔记',
  agreement: '约定',
  memory_entry: '记忆',
};
const COUNTS: Record<string, string> = {
  notes: '笔记',
  sources: '来源',
  concerns: '项目里的事',
  judgments: '判断',
  evidence: '证据',
  agreements: '约定',
  memory_entries: '记忆',
  tasks: '任务',
};
const FIELDS: Record<string, string> = {
  markdown: '正文',
  label: '名称',
  ref: '引用',
  title: '标题',
  why: '缘由',
  understanding: '理解',
  explanation: '解释',
  uncertainty: '不确定处',
  applicability: '适用范围',
  content: '内容',
  kind: '种类',
  digest: '摘要',
  proposedDiff: '修改提议',
  proposedTerm: '词义提议',
  text: '内容',
  provenance: '来路',
  scope: '范围',
  termTier: '用法',
};
export function backupCountLabel(key: string): string {
  return COUNTS[key] ?? '其他记录';
}
export function backupFieldLabel(key: string): string {
  return FIELDS[key] ?? '其他内容';
}

const EVIDENCE_KIND: Record<string, string> = {
  file: '文件',
  receipt: '回执',
  web: '网页',
  outcome: '实际结果',
  screenshot_digest: '截图摘要',
  message: '消息',
};
export function backupFieldValue(key: string, value: unknown): string {
  if (value == null) {
    return '未填写';
  }
  if (key === 'termTier') {
    return Object.entries(TERM_TIER_LABELS).find(([tier]) => tier === value)?.[1] ?? '待补';
  }
  if (key === 'kind') {
    return EVIDENCE_KIND[String(value)] ?? '其他内容';
  }
  return String(value);
}
