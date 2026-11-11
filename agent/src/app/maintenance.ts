// 长期维护入口的命令（第 115 条，2026-11-04 用户弹框定）。只从本机 unix socket 进来（maintenance-socket.ts），由运维
// Issue 里的 scripts/maint.ts 调用。写操作必须带用户的原话，记进 maintenance_operations；同一个操作号重放只回原结果。
// mail.refetch（用户 2026-11-04 定：旧邮件从 Gmail 重新抓回补齐格式）要连 Gmail，走异步的 performMaintenance。
// 2026-11-05 Harness 重做：任务的暂停 / 取消 / 归档、判断分流、「怎么替你做事」的一次性迁移删掉；status 改数线。

import {
  MAIL_REFETCH_DEFAULT_LIMIT,
  MAINTENANCE_WRITE_OPS,
  type MaintenanceOp,
  type MaintenanceRequest,
  type MaintenanceResponse,
} from '../../shared/api/maintenance.ts';
import type { RuleMode } from '../../shared/state.ts';
import { CloudToolError, type RefetchReport } from '../cloud-tools/index.ts';
import { rewriteRules } from '../brain/rules-rewrite.ts';
import { addClaudeItems, moveLine } from '../brain/memory-cleanup.ts';
import type { MemoryMoveItem } from '../../shared/api/maintenance.ts';
import { StateError, type StateService } from '../state/index.ts';

export interface MaintenanceDeps {
  state: StateService;
  /** 收信那一侧（mail.refetch 用）；AppDeps 里就是 m5b。 */
  m5b?: { cloud: { mailRefetch: { run(limit: number, signal: AbortSignal): Promise<RefetchReport> } } };
}

// 一次 mail.refetch 最多跑这么久：每块（十封）自己有 3 分钟的时限，200 封二十块，正常几分钟；超过就停，补过的已经存下。
const MAIL_REFETCH_TIMEOUT_MS = 30 * 60 * 1000;

export const MAINTENANCE_FAILURE_CODES = ['because_required', 'invalid_input', 'not_found', 'unavailable'] as const;
export type MaintenanceFailureCode = (typeof MAINTENANCE_FAILURE_CODES)[number];

/** 维护命令不能做（缺原话、参数不对、找不到、收信没装）。 */
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

function changeRuleMode(deps: MaintenanceDeps, request: MaintenanceRequest, quote: string) {
  const { state } = deps;
  if (request.code === undefined || request.mode === undefined) {
    throw new MaintenanceFailure('invalid_input', '「rules.mode」要给规则代号（--code）和档位（--mode off|observe|auto）。');
  }
  const rule = state.rules.byCode(request.code);
  if (rule === undefined) {
    throw new MaintenanceFailure('not_found', `没有代号是 ${request.code} 的规则。`);
  }
  const to: RuleMode = request.mode;
  if (rule.mode === to) {
    return { code: rule.code, mode: rule.mode, changed: false };
  }
  const reason = `Claude 依你的原话改成「${to}」：「${quote}」`;
  const updated = state.transaction(() => {
    const changed = state.rules.update(rule.id, rule.version, { mode: to },
      { actor: 'system', actorRef: `maintenance:${request.operationId}`, reason });
    state.rules.addEvent({ ruleId: rule.id, kind: 'mode_changed', fromMode: rule.mode, toMode: to,
      ruleVersion: changed.ruleVersion, actor: 'maintenance', reason });
    return changed;
  });
  return { code: updated.code, mode: updated.mode, changed: true };
}

function status(state: StateService) {
  const lines: Record<string, number> = {};
  for (const line of state.lines.list({ limit: 1_000 })) {
    lines[line.status] = (lines[line.status] ?? 0) + 1;
  }
  return {
    lines,
    rules: state.rules.all().map((rule) => ({ code: rule.code, mode: rule.mode })),
    recent: state.maintenanceOperations.recent().map((row) => ({ id: row.id, op: row.op, createdAt: row.createdAt })),
  };
}

function read(state: StateService, op: MaintenanceOp): unknown {
  if (op === 'status') {
    return status(state);
  }
  return state.rules.all().map((rule) => ({ code: rule.code, name: rule.name, mode: rule.mode }));
}

function write(deps: MaintenanceDeps, request: MaintenanceRequest, quote: string): unknown {
  if (request.op === 'rules.mode') {
    return changeRuleMode(deps, request, quote);
  }
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
  if (request.op === 'memory.cleanup.add') {
    if (request.adds === undefined) {
      throw new MaintenanceFailure('invalid_input', '「memory.cleanup.add」要给 --plan（新加哪几条）。');
    }
    const cleanup = addClaudeItems(deps.state, request.adds.map((add) => ({ ...add, reason: '' })));
    return { cleanupId: cleanup.id, added: request.adds.length };
  }
  throw new MaintenanceFailure('invalid_input', `不认识的写操作「${request.op}」。`);
}

/** memory.move：一行一行挪；有一行已经改过（版本对不上）整批不动。 */
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
  const args = { code: request.code ?? null, mode: request.mode ?? null, limit: request.limit ?? null,
    plan: request.plan ?? null, ...(request.moves === undefined ? {} : { moves: request.moves }),
    ...(request.adds === undefined ? {} : { adds: request.adds }) };
  state.maintenanceOperations.record({ id: request.operationId, op: request.op, args, because: quote, result });
}

async function refetchMail(deps: MaintenanceDeps, request: MaintenanceRequest): Promise<RefetchReport> {
  const refetch = deps.m5b?.cloud.mailRefetch;
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

/** 跑一条维护命令；写操作记进操作记录，同一个操作号再来只回原结果。 */
export function runMaintenance(deps: MaintenanceDeps, request: MaintenanceRequest): MaintenanceResponse {
  const { state } = deps;
  if (!MAINTENANCE_WRITE_OPS.includes(request.op)) {
    return { operationId: request.operationId, op: request.op, replayed: false, result: read(state, request.op) };
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

/**
 * 维护入口（socket）用的这一个：mail.refetch 连 Gmail、是异步的，别的照 runMaintenance。同一个操作号重放只回原结果；
 * 补到一半出错时补过的已经存下（重跑跳过），这一次不记操作。
 */
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
