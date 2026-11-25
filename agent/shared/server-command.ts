import { Type, type Static } from 'typebox';

export const SERVER_COMMAND_MAX_MS = 30 * 60_000;
export const ServerCommandRequestSchema = Type.Object({
  script: Type.String({ minLength: 1, maxLength: 60_000 }),
  cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: SERVER_COMMAND_MAX_MS })),
}, { additionalProperties: false });
export type ServerCommandRequest = Static<typeof ServerCommandRequestSchema>;
export const ServerCommandReadSchema = Type.Object({
  commandId: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
  taskId: Type.Optional(Type.String({ minLength: 1 })),
  stream: Type.Optional(Type.Enum(['stdout', 'stderr', 'script'])),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8_000 })),
}, { additionalProperties: false });

export const ServerCommandRecordSchema = Type.Object({
  id: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  actionId: Type.String({ minLength: 1 }),
  runId: Type.String({ minLength: 1 }),
  taskId: Type.Union([Type.String(), Type.Null()]),
  requestHash: Type.String(),
  script: Type.String(),
  cwd: Type.String(),
  timeoutMs: Type.Integer(),
  status: Type.Enum(['claimed', 'running', 'completed', 'timed_out', 'cancelled', 'output_limit',
    'start_failed', 'unknown']),
  pid: Type.Union([Type.Integer(), Type.Null()]),
  startedAt: Type.String(),
  finishedAt: Type.Union([Type.String(), Type.Null()]),
  exitCode: Type.Union([Type.Integer(), Type.Null()]),
  signal: Type.Union([Type.String(), Type.Null()]),
  stdoutBytes: Type.Integer({ minimum: 0 }),
  stderrBytes: Type.Integer({ minimum: 0 }),
  error: Type.Union([Type.String(), Type.Null()]),
});
export type ServerCommandRecord = Static<typeof ServerCommandRecordSchema>;
export type ServerCommandStatus = ServerCommandRecord['status'];
