import type { DatabaseSync } from 'node:sqlite';
import { callName } from './families.ts';

export interface ReplayCase {
  ref: string;
  lineId: string;
  seq: number;
  kind: string;
  expected: string[];
}

export interface PickOptions {
  count: number;
  background: number;
  perLine: number;
}

export const DEFAULT_PICK: PickOptions = { count: 14, background: 5, perLine: 3 };

interface CandidateRow {
  line_id: string;
  seq: number;
  kind: string;
  next: string;
}

const CANDIDATES = `SELECT m.line_id, m.seq, l.kind, n.message AS next FROM line_messages m
  JOIN lines l ON l.id = m.line_id
  JOIN line_messages n ON n.line_id = m.line_id AND n.seq = m.seq + 1 AND n.role = 'assistant'
  WHERE l.sealed_prompt IS NULL AND m.role IN ('user', 'handoff')
    AND instr(n.message, '"type":"toolCall"') > 0
    AND ((l.kind != 'background' AND json_extract(m.meta, '$.origin.kind') = 'user')
      OR (l.kind = 'background' AND m.seq <= 2))
  ORDER BY m.created_at DESC LIMIT 400`;

export function calledTools(message: unknown): string[] {
  const content = typeof message === 'object' && message !== null ? Reflect.get(message, 'content') : undefined;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((part: unknown) => {
    if (typeof part !== 'object' || part === null || Reflect.get(part, 'type') !== 'toolCall') {
      return [];
    }
    const name: unknown = Reflect.get(part, 'name');
    return typeof name === 'string' ? [callName(name, Reflect.get(part, 'arguments'))] : [];
  });
}

function caseOf(row: CandidateRow): ReplayCase {
  return { ref: `line:${row.line_id}:${row.seq}`, lineId: row.line_id, seq: row.seq, kind: row.kind,
    expected: calledTools(JSON.parse(row.next)) };
}

export function pickCases(db: DatabaseSync, options: PickOptions = DEFAULT_PICK): ReplayCase[] {
  const rows = db.prepare(CANDIDATES).all() as unknown as CandidateRow[];
  const picked: ReplayCase[] = [];
  const perLine = new Map<string, number>();
  let background = 0;
  for (const row of rows) {
    const used = perLine.get(row.line_id) ?? 0;
    const isBackground = row.kind === 'background';
    const full = isBackground && background >= options.background;
    if (picked.length >= options.count || used >= options.perLine || full) {
      continue;
    }
    picked.push(caseOf(row));
    perLine.set(row.line_id, used + 1);
    background += isBackground ? 1 : 0;
  }
  return picked;
}

const BY_REF = `SELECT m.line_id, m.seq, l.kind, n.message AS next FROM line_messages m
  JOIN lines l ON l.id = m.line_id
  JOIN line_messages n ON n.line_id = m.line_id AND n.seq = m.seq + 1
  WHERE m.line_id = $line AND m.seq = $seq`;

export function casesByRef(db: DatabaseSync, refs: readonly string[]): ReplayCase[] {
  const statement = db.prepare(BY_REF);
  return refs.flatMap((ref) => {
    const match = /^line:(.+):(\d+)$/.exec(ref);
    if (match === null) {
      return [];
    }
    const row = statement.get({ line: match[1] ?? '', seq: Number(match[2]) }) as unknown as CandidateRow | undefined;
    return row === undefined ? [] : [caseOf(row)];
  });
}
