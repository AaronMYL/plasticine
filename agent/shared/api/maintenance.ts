// 第 115 条（2026-11-04 用户弹框定）：长期维护入口。只在服务器本机的 unix socket 上收（文件权限 0600，Caddy 够不着），
// 由运维 Issue 里的 `scripts/maint.ts` 调用，不用每次现写临时脚本。写操作必须带上用户的原话（弹框里的回答或他说的话），
// 记进 maintenance_operations；同一个操作号重放只回原来的结果，不再动一次。

import { Type, type Static } from 'typebox';
import { RULE_MODES } from '../state.ts';
import { SOUL_SECTIONS } from './soul.ts';

/**
 * 只读：status、rules.list；其余是写操作，要原话。2026-11-05 Harness 重做：任务没了，tasks.*（暂停 / 取消 / 归档）
 * 删掉；判断页、「怎么替你做事」的一次性迁移（judgments.*、rulesdoc.*）早已做完，一起删了。在跑的线看 status。
 */
export const MAINTENANCE_OPS = [
  'status',
  'rules.list',
  'rules.mode',
  'mail.refetch',
  // 11-11：Aaron 让 Claude 整理「规则」——一行拆成几行、改成平常话、过时的挪进归档；每行留原来的来源。
  'rules.rewrite',
  // 11-11 记忆改版：Aaron 让把「个人」项目的记忆并进「关于你」（memory.move），把 Claude 记得的他的情况放进整理清单
  // 等他勾选（memory.cleanup.add）。
  'memory.move',
  'memory.cleanup.add',
] as const;
export type MaintenanceOp = (typeof MAINTENANCE_OPS)[number];

export const MAINTENANCE_WRITE_OPS: readonly MaintenanceOp[] = ['rules.mode', 'mail.refetch', 'rules.rewrite',
  'memory.move', 'memory.cleanup.add'];

/** memory.move 的一项：这一行挪到 toDocId。 */
export const MemoryMoveItemSchema = Type.Object({
  lineId: Type.String({ minLength: 1, maxLength: 80 }),
  version: Type.Integer({ minimum: 1 }),
  toDocId: Type.String({ minLength: 1, maxLength: 80 }),
}, { additionalProperties: false });
export type MemoryMoveItem = Static<typeof MemoryMoveItemSchema>;

/** memory.cleanup.add 的一项：清单里新加一条（不注明来处）。给 person（人名）时加进这个人的那一页，没有就建一页。 */
export const MemoryCleanupAddSchema = Type.Object({
  toDocId: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  person: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  text: Type.String({ minLength: 1, maxLength: 600 }),
}, { additionalProperties: false });
export type MemoryCleanupAdd = Static<typeof MemoryCleanupAddSchema>;

/** rules.rewrite 的一项：这一行换成 into 里的几行（空 = 不再成立，挪进归档）。 */
export const RulesRewriteItemSchema = Type.Object({
  lineId: Type.String({ minLength: 1, maxLength: 80 }),
  version: Type.Integer({ minimum: 1 }),
  into: Type.Array(Type.Object({ text: Type.String({ minLength: 1, maxLength: 500 }),
    section: Type.Enum(SOUL_SECTIONS) }, { additionalProperties: false }), { maxItems: 20 }),
}, { additionalProperties: false });
export type RulesRewriteItem = Static<typeof RulesRewriteItemSchema>;

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
    /** rules.rewrite 的整理方案。 */
    plan: Type.Optional(Type.Array(RulesRewriteItemSchema, { minItems: 1, maxItems: 100 })),
    /** memory.move 挪哪几行。 */
    moves: Type.Optional(Type.Array(MemoryMoveItemSchema, { minItems: 1, maxItems: 200 })),
    /** memory.cleanup.add 新加哪几条。 */
    adds: Type.Optional(Type.Array(MemoryCleanupAddSchema, { minItems: 1, maxItems: 200 })),
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
