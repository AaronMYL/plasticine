import type { Row } from './db.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

export const APPROVAL_STATUSES = ['pending', 'approved', 'used', 'declined', 'withdrawn'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface LineApproval {
  id: string;
  lineId: string;
  toolCallId: string;
  toolName: string;
  argsDigest: string;
  hardLine: string;
  askId: string;
  status: ApprovalStatus;
  answer: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewLineApproval {
  lineId: string;
  toolCallId: string;
  toolName: string;
  argsDigest: string;
  hardLine: string;
  askId: string;
}

function approvalOf(row: Row): LineApproval {
  const answer = row['answer'];
  return {
    id: String(row['id']),
    lineId: String(row['line_id']),
    toolCallId: String(row['tool_call_id']),
    toolName: String(row['tool_name']),
    argsDigest: String(row['args_digest']),
    hardLine: String(row['hard_line']),
    askId: String(row['ask_id']),
    status: String(row['status']) as ApprovalStatus,
    answer: answer === null || answer === undefined ? null : String(answer),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

export function createLineApprovalStore(context: StoreContext) {
  const { db } = context;
  const get = (id: string): LineApproval | undefined => {
    const row = db.get('SELECT * FROM line_approvals WHERE id = $id', { id });
    return row === undefined ? undefined : approvalOf(row);
  };
  return {
    get,
    create(input: NewLineApproval): LineApproval {
      const id = `approval-${context.newId()}`;
      const at = context.now();
      db.run(`INSERT INTO line_approvals (id, line_id, tool_call_id, tool_name, args_digest, hard_line, ask_id,
          status, created_at, updated_at)
        VALUES ($id, $lineId, $toolCallId, $toolName, $digest, $hardLine, $askId, 'pending', $at, $at)`, {
        id, lineId: input.lineId, toolCallId: input.toolCallId, toolName: input.toolName,
        digest: input.argsDigest, hardLine: input.hardLine, askId: input.askId, at,
      });
      return get(id)!;
    },
    forCall(lineId: string, toolCallId: string): LineApproval | undefined {
      const row = db.get('SELECT * FROM line_approvals WHERE line_id = $lineId AND tool_call_id = $toolCallId',
        { lineId, toolCallId });
      return row === undefined ? undefined : approvalOf(row);
    },
    byAsk(askId: string): LineApproval | undefined {
      const row = db.get('SELECT * FROM line_approvals WHERE ask_id = $askId', { askId });
      return row === undefined ? undefined : approvalOf(row);
    },
    pending(lineId: string): LineApproval[] {
      return db.all(`SELECT * FROM line_approvals WHERE line_id = $lineId AND status = 'pending'
        ORDER BY created_at`, { lineId }).map(approvalOf);
    },
    setStatus(id: string, status: ApprovalStatus, options: { from?: ApprovalStatus; answer?: string | null } = {})
      : LineApproval | undefined {
      const guard = options.from === undefined ? '' : ' AND status = $from';
      const changed = db.run(`UPDATE line_approvals SET status = $status, updated_at = $at
          ${'answer' in options ? ', answer = $answer' : ''} WHERE id = $id${guard}`, {
        id, status, at: context.now(),
        ...(options.from === undefined ? {} : { from: options.from }),
        ...('answer' in options ? { answer: options.answer ?? null } : {}),
      });
      if (changed === 0 && options.from === undefined) {
        throw new StateError('not_found', `没有这次批准：${id}`);
      }
      return changed === 0 ? undefined : get(id);
    },
  };
}

export type LineApprovalStore = ReturnType<typeof createLineApprovalStore>;
