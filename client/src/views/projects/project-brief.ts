import type { ProjectBrief, ProjectDecisionView } from '../../api/shared.ts';
import { BRIEF_FIELDS } from './project-edit.tsx';

export interface BriefRow {
  key: string;
  label: string;
  value: string;
  quoteRef?: string;
}

const DECISION_LABEL = '定了';

const LABEL_MAX = 6;

function labelled(key: string, line: string, fallback: string): BriefRow {
  const match = /^([^：:]{1,20})[：:]\s*(.+)$/.exec(line);
  const label = match?.[1]?.trim();
  return label !== undefined && label.length <= LABEL_MAX && match?.[2] !== undefined
    ? { key, label, value: match[2].trim() } : { key, label: fallback, value: line };
}

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
