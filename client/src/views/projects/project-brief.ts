// 项目档案一行一条（2026-11-05 设计稿 Project）：档案的四栏（目标、约束、规矩、用词）按行拆开；一行写成「标签：内容」的，
// 标签就用它自己的（「中继：放腾讯云，只转加密字节」），不然用那一栏的名字。空的不出现。

import type { ProjectBrief, ProjectDecisionView } from '../../api/shared.ts';
import { BRIEF_FIELDS } from './project-edit.tsx';

export interface BriefRow {
  key: string;
  label: string;
  value: string;
  /** 定下这件事时他说的那句（line:<线>:<序号>）；档案栏里手写的没有。 */
  quoteRef?: string;
}

const DECISION_LABEL = '定了';

/** 「标签：内容」里的标签最长几个字：再长就不像标签，整行当内容。 */
const LABEL_MAX = 6;

function labelled(key: string, line: string, fallback: string): BriefRow {
  const match = /^([^：:]{1,20})[：:]\s*(.+)$/.exec(line);
  const label = match?.[1]?.trim();
  return label !== undefined && label.length <= LABEL_MAX && match?.[2] !== undefined
    ? { key, label, value: match[2].trim() } : { key, label: fallback, value: line };
}

/** 档案的四栏，再接上对话里定下的事（带原话）。 */
export function briefRows(brief: ProjectBrief, decisions: readonly ProjectDecisionView[] = []): BriefRow[] {
  const written = BRIEF_FIELDS.flatMap((field) => brief[field.key].split('\n').map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line, index) => labelled(`${field.key}-${index}`, line, field.label)));
  const decided = decisions.map((decision) => {
    const row = labelled(`decision-${decision.id}`, decision.text.trim(), DECISION_LABEL);
    return decision.quoteRef === null ? row : { ...row, quoteRef: decision.quoteRef };
  });
  return [...written, ...decided];
}
