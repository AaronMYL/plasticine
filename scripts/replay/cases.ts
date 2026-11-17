// 回放挑哪几件（内核优化第三批，11-17）：从线上库副本里自动挑他真实发过的话，不把正文带出服务器。
// 一件 = 一条消息（他在主线、队友对话里说的话，或者一条后台线开头交代的事）加上线上紧接着那一次回答里调了哪些工具。
// 只挑紧接着调了工具的：回放看的是「挑工具挑得对不对」。挑出来的只是引用（line:<线>:<序号>），下次照引用回放同一批。

import type { DatabaseSync } from 'node:sqlite';
import { callName } from './families.ts';

export interface ReplayCase {
  ref: string;
  lineId: string;
  seq: number;
  kind: string;
  /** 线上那一次调的工具（callName 的叫法），按顺序。 */
  expected: string[];
}

export interface PickOptions {
  /** 一共挑几件。 */
  count: number;
  /** 其中后台线开头的最多几件。 */
  background: number;
  /** 同一条线最多几件（免得全是同一件事）。 */
  perLine: number;
}

export const DEFAULT_PICK: PickOptions = { count: 12, background: 4, perLine: 3 };

interface CandidateRow {
  line_id: string;
  seq: number;
  kind: string;
  next: string;
}

// 下一条是带工具调用的回答。他说的话（origin user）在主线、旁聊和队友对话里；后台线只看开头那两条。
const CANDIDATES = `SELECT m.line_id, m.seq, l.kind, n.message AS next FROM line_messages m
  JOIN lines l ON l.id = m.line_id
  JOIN line_messages n ON n.line_id = m.line_id AND n.seq = m.seq + 1 AND n.role = 'assistant'
  WHERE l.sealed_prompt IS NULL AND m.role IN ('user', 'handoff')
    AND instr(n.message, '"type":"toolCall"') > 0
    AND ((l.kind != 'background' AND json_extract(m.meta, '$.origin.kind') = 'user')
      OR (l.kind = 'background' AND m.seq <= 2))
  ORDER BY m.created_at DESC LIMIT 400`;

/** 一段回答里调了哪些工具（callName 的叫法）。 */
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

/** 从库里挑：新的在前，每条线不超过 perLine 件，后台线开头不超过 background 件。 */
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

/** 照引用取回同一批（上一次挑的）；库里没有了的跳过。 */
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
