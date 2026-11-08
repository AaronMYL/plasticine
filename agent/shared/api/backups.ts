import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
const STRICT = { additionalProperties: false };
const NullableId = Type.Union([IdSchema, Type.Null()]);
const Digest = Type.String({ pattern: '^[a-f0-9]{64}$' });
// 2026-11-05：来源、关切、判断、证据、任务的表删掉了，能按对象恢复的只剩这三种。
export const BackupObjectKindSchema = Type.Enum([
  'note',
  'agreement',
  'memory_entry',
]);
export type BackupObjectKind = Static<typeof BackupObjectKindSchema>;
export const BackupSchema = Type.Object(
  {
    id: IdSchema,
    requestId: RequestIdSchema,
    name: Type.String(),
    reason: Type.Enum(['daily', 'manual', 'before_restore']),
    status: Type.Enum(['queued', 'running', 'ready', 'partial', 'failed', 'expired']),
    createdAt: IsoTimeSchema,
    completedAt: Type.Union([IsoTimeSchema, Type.Null()]),
    bytes: Type.Integer({ minimum: 0 }),
    objectCount: Type.Optional(Type.Integer({ minimum: 0 })),
    manifestDigest: Type.Union([Digest, Type.Null()]),
    taskId: NullableId,
    error: Type.Union([Type.String(), Type.Null()]),
    privatePermissions: Type.Boolean(),
  },
  STRICT,
);
export type Backup = Static<typeof BackupSchema>;
export const BackupObjectSchema = Type.Object(
  {
    kind: BackupObjectKindSchema,
    id: IdSchema,
    label: Type.String(),
    version: Type.Integer({ minimum: 1 }),
    private: Type.Boolean(),
  },
  STRICT,
);
export type BackupObject = Static<typeof BackupObjectSchema>;
export const BackupDetailSchema = Type.Object(
  {
    backup: BackupSchema,
    objects: Type.Array(BackupObjectSchema),
    valid: Type.Boolean(),
    scope: Type.String(),
    excluded: Type.Array(Type.String()),
    schema: Type.Array(Type.String()),
    counts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  },
  STRICT,
);
export type BackupDetail = Static<typeof BackupDetailSchema>;
export const RestorePreviewSchema = Type.Object(
  {
    id: IdSchema,
    backupId: IdSchema,
    backupName: Type.String(),
    backupCreatedAt: Type.Optional(IsoTimeSchema),
    objectLabel: Type.Optional(Type.String()),
    kind: BackupObjectKindSchema,
    objectId: IdSchema,
    baseVersion: Type.Integer({ minimum: 0 }),
    sourceVersion: Type.Integer({ minimum: 1 }),
    digest: Digest,
    before: Type.String(),
    after: Type.String(),
    private: Type.Boolean(),
    fields: Type.Array(Type.String()),
    excluded: Type.Array(Type.String()),
    blocked: Type.Array(Type.String()),
    status: Type.Enum(['pending', 'restored', 'rejected']),
    askId: NullableId,
    askVersion: Type.Integer({ minimum: 0 }),
    safetyBackupId: NullableId,
    resultVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  STRICT,
);
export type RestorePreview = Static<typeof RestorePreviewSchema>;
export const BackupListSchema = Type.Object(
  { backups: Type.Array(BackupSchema), retentionDays: Type.Literal(30), schedule: Type.String() },
  STRICT,
);
export type BackupList = Static<typeof BackupListSchema>;
export const CreateBackupRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type CreateBackupRequest = Static<typeof CreateBackupRequestSchema>;
export const RestorePreviewRequestSchema = Type.Object(
  { requestId: RequestIdSchema, kind: BackupObjectKindSchema, objectId: IdSchema },
  STRICT,
);
export type RestorePreviewRequest = Static<typeof RestorePreviewRequestSchema>;
export const RestoreBackupRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    previewId: IdSchema,
    digest: Digest,
    backupName: Type.String(),
    askVersion: Type.Integer({ minimum: 1 }),
  },
  STRICT,
);
export type RestoreBackupRequest = Static<typeof RestoreBackupRequestSchema>;
