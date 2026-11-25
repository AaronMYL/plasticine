import { Type, type Static } from 'typebox';
import { MEMORY_LINE_SECTIONS } from '../state.ts';
import { SOUL_SECTIONS } from './soul.ts';

export const MAINTENANCE_OPS = [
  'status',
  'mail.refetch',
  'rules.rewrite',
  'memory.move',
  'memory.cleanup.add',
  'memory.layers',
  'suggestions.dismiss',
  'inbox.archive',
  'line.start',
] as const;
export type MaintenanceOp = (typeof MAINTENANCE_OPS)[number];

export const MAINTENANCE_WRITE_OPS: readonly MaintenanceOp[] = ['mail.refetch', 'rules.rewrite',
  'memory.move', 'memory.cleanup.add', 'memory.layers', 'suggestions.dismiss', 'inbox.archive', 'line.start'];

export const MemoryMoveItemSchema = Type.Object({
  lineId: Type.String({ minLength: 1, maxLength: 80 }),
  version: Type.Integer({ minimum: 1 }),
  toDocId: Type.String({ minLength: 1, maxLength: 80 }),
  section: Type.Optional(Type.Enum(MEMORY_LINE_SECTIONS)),
}, { additionalProperties: false });
export type MemoryMoveItem = Static<typeof MemoryMoveItemSchema>;

export const MemoryCleanupAddSchema = Type.Object({
  toDocId: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  person: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  text: Type.String({ minLength: 1, maxLength: 600 }),
}, { additionalProperties: false });

export const RulesRewriteItemSchema = Type.Object({
  lineId: Type.String({ minLength: 1, maxLength: 80 }),
  version: Type.Integer({ minimum: 1 }),
  into: Type.Array(Type.Object({ text: Type.String({ minLength: 1, maxLength: 500 }),
    section: Type.Enum(SOUL_SECTIONS) }, { additionalProperties: false }), { maxItems: 20 }),
}, { additionalProperties: false });
export type RulesRewriteItem = Static<typeof RulesRewriteItemSchema>;

export const MAIL_REFETCH_DEFAULT_LIMIT = 30;
export const MAIL_REFETCH_MAX_LIMIT = 200;

export const MaintenanceRequestSchema = Type.Object(
  {
    operationId: Type.String({ minLength: 4, maxLength: 80, pattern: '^[A-Za-z0-9_.:-]+$' }),
    op: Type.Enum(MAINTENANCE_OPS),
    because: Type.Optional(Type.String({ maxLength: 2_000 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAIL_REFETCH_MAX_LIMIT })),
    plan: Type.Optional(Type.Array(RulesRewriteItemSchema, { minItems: 1, maxItems: 100 })),
    moves: Type.Optional(Type.Array(MemoryMoveItemSchema, { minItems: 1, maxItems: 200 })),
    ids: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { minItems: 1, maxItems: 100 })),
    sources: Type.Optional(Type.Array(Type.Enum(['patrol', 'feedback', 'interview']), { minItems: 1, maxItems: 3 })),
    line: Type.Optional(Type.Object({ title: Type.String({ minLength: 1, maxLength: 60 }),
      goal: Type.String({ minLength: 1, maxLength: 4_000 }) }, { additionalProperties: false })),
    adds: Type.Optional(Type.Array(MemoryCleanupAddSchema, { minItems: 1, maxItems: 200 })),
  },
  { additionalProperties: false },
);
export type MaintenanceRequest = Static<typeof MaintenanceRequestSchema>;

export const MaintenanceResponseSchema = Type.Object({
  operationId: Type.String(),
  op: Type.Enum(MAINTENANCE_OPS),
  replayed: Type.Boolean(),
  result: Type.Unknown(),
});
export type MaintenanceResponse = Static<typeof MaintenanceResponseSchema>;

export const MaintenanceErrorSchema = Type.Object({ error: Type.String(), message: Type.String() });
export type MaintenanceError = Static<typeof MaintenanceErrorSchema>;

export const MAINTENANCE_COMMAND_PATH = '/v1/maintenance';
export const MAINTENANCE_SOCKET_FILE = 'maintenance.sock';
