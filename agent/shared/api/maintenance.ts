// 第 115 条（2026-11-04 用户弹框定）：长期维护入口。只在服务器本机的 unix socket 上收（文件权限 0600，Caddy 够不着），
// 由运维 Issue 里的 `scripts/maint.ts` 调用，不用每次现写临时脚本。写操作必须带上用户的原话（弹框里的回答或他说的话），
// 记进 maintenance_operations；同一个操作号重放只回原来的结果，不再动一次。

import { Type, type Static } from 'typebox';
import { RULE_MODES } from '../state.ts';

/**
 * 只读：status、rules.list；其余是写操作，要原话。2026-11-05 Harness 重做：任务没了，tasks.*（暂停 / 取消 / 归档）
 * 删掉；判断页、「怎么替你做事」的一次性迁移（judgments.*、rulesdoc.*）早已做完，一起删了。在跑的线看 status。
 */
export const MAINTENANCE_OPS = [
  'status',
  'rules.list',
  'rules.mode',
  'mail.refetch',
] as const;
export type MaintenanceOp = (typeof MAINTENANCE_OPS)[number];

export const MAINTENANCE_WRITE_OPS: readonly MaintenanceOp[] = ['rules.mode', 'mail.refetch'];

// mail.refetch（用户 2026-11-04 定：旧邮件从 Gmail 重新抓回补齐格式）：一次默认补 30 封、最多 200 封——一个运维 Issue
// 的回执看得过来，也不在一条维护命令里占着服务太久；还剩的看结果里的 remaining，换个操作号再跑。
export const MAIL_REFETCH_DEFAULT_LIMIT = 30;
export const MAIL_REFETCH_MAX_LIMIT = 200;

export const MaintenanceRequestSchema = Type.Object(
  {
    /** 操作号：回执和重放用；运维 Issue 里写死一个，重跑同一个 Issue 不会再动一次。 */
    operationId: Type.String({ minLength: 4, maxLength: 80, pattern: '^[A-Za-z0-9_.:-]+$' }),
    op: Type.Enum(MAINTENANCE_OPS),
    /** 用户的原话；写操作必填。 */
    because: Type.Optional(Type.String({ maxLength: 2_000 })),
    code: Type.Optional(Type.String({ pattern: '^[a-z][a-z0-9_]{1,40}$' })),
    mode: Type.Optional(Type.Enum(RULE_MODES)),
    /** mail.refetch 这次补几封。 */
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAIL_REFETCH_MAX_LIMIT })),
  },
  { additionalProperties: false },
);
export type MaintenanceRequest = Static<typeof MaintenanceRequestSchema>;

export const MaintenanceResponseSchema = Type.Object({
  operationId: Type.String(),
  op: Type.Enum(MAINTENANCE_OPS),
  /** 同一个操作号以前做过：这次没有再动，回的是当时的结果。 */
  replayed: Type.Boolean(),
  result: Type.Unknown(),
});
export type MaintenanceResponse = Static<typeof MaintenanceResponseSchema>;

export const MaintenanceErrorSchema = Type.Object({ error: Type.String(), message: Type.String() });
export type MaintenanceError = Static<typeof MaintenanceErrorSchema>;

/** socket 上唯一的路径。 */
export const MAINTENANCE_COMMAND_PATH = '/v1/maintenance';
/** 状态目录下的 socket 文件名（<PLASTICINE_STATE>/maintenance.sock）。 */
export const MAINTENANCE_SOCKET_FILE = 'maintenance.sock';
