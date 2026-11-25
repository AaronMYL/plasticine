import {
  MAIL_REFETCH_DEFAULT_LIMIT, MAINTENANCE_WRITE_OPS, type MaintenanceRequest,
  type MaintenanceResponse, type MemoryMoveItem,
} from '../../shared/api/maintenance.ts';
import { CloudToolError, type RefetchReport } from '../cloud-tools/index.ts';
import { addClaudeItems, applyLayersMove, ensureMemoryDocs, moveLine, rewriteRules } from '../memory/index.ts';
import type { LineKernel } from '../lines/index.ts';
import { StateError, type StateService } from '../state/index.ts';

export interface MaintenanceDeps {
  state: StateService;
  toolGroups?: { cloud: { mailRefetch: { run(limit: number, signal: AbortSignal): Promise<RefetchReport> } } };
  lines?: Pick<LineKernel, 'open'>;
}

const MAIL_REFETCH_TIMEOUT_MS = 30 * 60 * 1000;

export const MAINTENANCE_FAILURE_CODES = ['because_required', 'invalid_input', 'not_found', 'unavailable'] as const;
export type MaintenanceFailureCode = (typeof MAINTENANCE_FAILURE_CODES)[number];

export class MaintenanceFailure extends Error {
  readonly code: MaintenanceFailureCode;

  constructor(code: MaintenanceFailureCode, message: string) {
    super(message);
    this.name = 'MaintenanceFailure';
    this.code = code;
  }
}

function because(request: MaintenanceRequest): string {
  const text = request.because?.trim() ?? '';
  if (text === '') {
    throw new MaintenanceFailure('because_required', `「${request.op}」要带上用户的原话（--because），这次没有执行。`);
  }
  return text;
}

function status(state: StateService) {
  const lines: Record<string, number> = {};
  for (const line of state.lines.list({ limit: 1_000 })) {
    lines[line.status] = (lines[line.status] ?? 0) + 1;
  }
  return {
    lines,
    recent: state.maintenanceOperations.recent().map((row) => ({ id: row.id, op: row.op, createdAt: row.createdAt })),
  };
}

function write(deps: MaintenanceDeps, request: MaintenanceRequest, quote: string): unknown {
  if (request.op === 'mail.refetch') {
    throw new MaintenanceFailure('invalid_input', '「mail.refetch」要连 Gmail，走 performMaintenance。');
  }
  if (request.op === 'rules.rewrite') {
    if (request.plan === undefined) {
      throw new MaintenanceFailure('invalid_input', '「rules.rewrite」要给整理方案（--plan 一个 JSON 文件）。');
    }
    return rewriteRules(deps.state, request.plan, `maintenance:${request.operationId}`, quote);
  }
  if (request.op === 'memory.move') {
    if (request.moves === undefined) {
      throw new MaintenanceFailure('invalid_input', '「memory.move」要给 --plan（挪哪几行）。');
    }
    return moveMemoryLines(deps.state, request.moves, `maintenance:${request.operationId}`);
  }
  if (request.op === 'memory.layers') {
    if (request.moves === undefined) {
      throw new MaintenanceFailure('invalid_input', '「memory.layers」要给 --plan（挪哪几行）。');
    }
    ensureMemoryDocs(deps.state);
    try {
      return applyLayersMove(deps.state, request.moves, request.operationId);
    } catch (error) {
      if (error instanceof StateError) throw error;
      throw new MaintenanceFailure('invalid_input', error instanceof Error ? error.message : String(error));
    }
  }
  if (request.op === 'memory.cleanup.add') {
    if (request.adds === undefined) {
      throw new MaintenanceFailure('invalid_input', '「memory.cleanup.add」要给 --plan（新加哪几条）。');
    }
    const cleanup = addClaudeItems(deps.state, request.adds.map((add) => ({ toDocId: targetDoc(deps.state, add),
      text: add.text, reason: '' })));
    return { cleanupId: cleanup.id, added: request.adds.length };
  }
  if (request.op === 'suggestions.dismiss') {
    if (request.ids === undefined) {
      throw new MaintenanceFailure('invalid_input', '「suggestions.dismiss」要给 --ids（逗号隔开的建议 id）。');
    }
    return dismissSuggestions(deps.state, request.ids, `maintenance:${request.operationId}`);
  }
  if (request.op === 'line.start') {
    return startLine(deps, request);
  }
  if (request.op === 'inbox.archive') {
    if (request.sources === undefined) {
      throw new MaintenanceFailure('invalid_input', '「inbox.archive」要给 --sources（patrol,feedback,interview 里的几个）。');
    }
    return archiveInbox(deps.state, request.sources);
  }
  throw new MaintenanceFailure('invalid_input', `不认识的写操作「${request.op}」。`);
}

function startLine(deps: MaintenanceDeps, request: MaintenanceRequest) {
  if (request.line === undefined) {
    throw new MaintenanceFailure('invalid_input', '「line.start」要给 --plan（{title, goal}）。');
  }
  if (deps.lines === undefined) {
    throw new MaintenanceFailure('unavailable', '这台服务没有线的内核。');
  }
  const view = deps.lines.open({ title: request.line.title, goal: request.line.goal, projectId: null,
    parentLineId: deps.state.lines.main().id, origin: { kind: 'system', ref: `maintenance:${request.operationId}` } });
  return { lineId: view.id };
}

const ARCHIVE_MAX = 500;

function archiveInbox(state: StateService, sources: readonly ('patrol' | 'feedback' | 'interview')[]) {
  return state.transaction(() => {
    const at = new Date().toISOString();
    const archived: { id: string; source: string; title: string }[] = [];
    for (const source of sources) {
      const messages = state.inboxMessages.page({ box: source }, { limit: ARCHIVE_MAX });
      if (state.inboxMessages.count({ box: source }) > ARCHIVE_MAX) {
        throw new MaintenanceFailure('invalid_input', `「${source}」有 ${ARCHIVE_MAX} 封以上，不像旧功能留下的，这次没动。`);
      }
      for (const message of messages) {
        state.inboxMessages.update(message.id, message.version, { archivedAt: at });
        archived.push({ id: message.id, source, title: message.title });
      }
    }
    return { archived: archived.length, messages: archived };
  });
}

function dismissSuggestions(state: StateService, ids: readonly string[], ref: string) {
  return state.transaction(() => {
    const at = new Date().toISOString();
    const rows = ids.map((id) => {
      const suggestion = state.suggestions.get(id);
      if (suggestion === undefined) {
        throw new MaintenanceFailure('invalid_input', `没有这条建议：${id}。这次一条都没动。`);
      }
      return suggestion;
    });
    const before = rows.map((row) => ({ id: row.id, title: row.title, status: row.status }));
    const open = rows.filter((row) => row.status === 'open');
    for (const row of open) {
      state.suggestions.update(row.id, row.version, { status: 'dismissed', actedAt: at, actedByDeviceId: ref });
    }
    return { dismissed: open.length, skipped: rows.length - open.length, before };
  });
}

function targetDoc(state: StateService, add: { toDocId?: string | undefined; person?: string | undefined }): string {
  if (add.toDocId !== undefined) return add.toDocId;
  const name = add.person?.trim() ?? '';
  if (name === '') throw new MaintenanceFailure('invalid_input', '新加的一条要给 toDocId 或 person。');
  const found = state.memoryDocs.docs.live().find((doc) => doc.kind === 'person' && doc.title === name);
  return (found ?? state.memoryDocs.docs.create({ kind: 'person', title: name, summary: '', createdBy: 'user' })).id;
}

function moveMemoryLines(state: StateService, moves: readonly MemoryMoveItem[], ref: string): { moved: number } {
  return state.transaction(() => {
    for (const move of moves) {
      const line = state.memoryDocs.lines.require(move.lineId);
      if (line.retiredAt !== null || line.version !== move.version) {
        throw new StateError('version_conflict', `记忆 ${move.lineId} 已经改过，这次没有挪。`);
      }
      moveLine(state, line, move.toDocId, { actor: 'system', ref });
    }
    return { moved: moves.length };
  });
}

function record(state: StateService, request: MaintenanceRequest, quote: string, result: unknown): void {
  const args = { limit: request.limit ?? null,
    plan: request.plan ?? null, ...(request.moves === undefined ? {} : { moves: request.moves }),
    ...(request.adds === undefined ? {} : { adds: request.adds }),
    ...(request.ids === undefined ? {} : { ids: request.ids }),
    ...(request.sources === undefined ? {} : { sources: request.sources }) };
  state.maintenanceOperations.record({ id: request.operationId, op: request.op, args, because: quote, result });
}

async function refetchMail(deps: MaintenanceDeps, request: MaintenanceRequest): Promise<RefetchReport> {
  const refetch = deps.toolGroups?.cloud.mailRefetch;
  if (refetch === undefined) {
    throw new MaintenanceFailure('unavailable', '这台服务没装收信，没法从 Gmail 重新抓。');
  }
  try {
    return await refetch.run(request.limit ?? MAIL_REFETCH_DEFAULT_LIMIT, AbortSignal.timeout(MAIL_REFETCH_TIMEOUT_MS));
  } catch (error) {
    if (error instanceof CloudToolError) {
      throw new MaintenanceFailure('unavailable', error.message);
    }
    throw error;
  }
}

export function runMaintenance(deps: MaintenanceDeps, request: MaintenanceRequest): MaintenanceResponse {
  const { state } = deps;
  if (!MAINTENANCE_WRITE_OPS.includes(request.op)) {
    return { operationId: request.operationId, op: request.op, replayed: false, result: status(state) };
  }
  const previous = state.maintenanceOperations.get(request.operationId);
  if (previous !== undefined) {
    return { operationId: previous.id, op: request.op, replayed: true, result: previous.result };
  }
  const quote = because(request);
  const result = write(deps, request, quote);
  record(state, request, quote, result);
  return { operationId: request.operationId, op: request.op, replayed: false, result };
}

export async function performMaintenance(deps: MaintenanceDeps, request: MaintenanceRequest):
  Promise<MaintenanceResponse> {
  if (request.op !== 'mail.refetch') {
    return runMaintenance(deps, request);
  }
  const previous = deps.state.maintenanceOperations.get(request.operationId);
  if (previous !== undefined) {
    return { operationId: previous.id, op: request.op, replayed: true, result: previous.result };
  }
  const quote = because(request);
  const result = await refetchMail(deps, request);
  record(deps.state, request, quote, result);
  return { operationId: request.operationId, op: request.op, replayed: false, result };
}
