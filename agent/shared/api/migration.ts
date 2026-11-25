import { Type, type Static } from 'typebox';
import { IsoTimeSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false } as const;

export const MIGRATION_PATH = '/v2/migration';
export const MIGRATION_EXPORT_PATH = `${MIGRATION_PATH}/export`;
export const MIGRATION_EXPORT_CANCEL_PATH = `${MIGRATION_EXPORT_PATH}/cancel`;
export const MIGRATION_EXPORT_FILE_PATH = `${MIGRATION_EXPORT_PATH}/file`;
export const MIGRATION_IMPORT_PATH = `${MIGRATION_PATH}/import`;
export const migrationChunkPath = (offset: number): string => `${MIGRATION_IMPORT_PATH}/chunks/${offset}`;
export const MIGRATION_IMPORT_COMPLETE_PATH = `${MIGRATION_IMPORT_PATH}/complete`;
export const MIGRATION_IMPORT_UNLOCK_PATH = `${MIGRATION_IMPORT_PATH}/unlock`;
export const MIGRATION_IMPORT_APPLY_PATH = `${MIGRATION_IMPORT_PATH}/apply`;
export const MIGRATION_IMPORT_CANCEL_PATH = `${MIGRATION_IMPORT_PATH}/cancel`;
export const MIGRATION_UNDO_PATH = `${MIGRATION_PATH}/undo`;

export const MIGRATION_CHUNK_BYTES = 8 * 1024 * 1024;
export const MIGRATION_MAX_BYTES = 64 * 1024 ** 3;
export const MIGRATION_PASSPHRASE_MIN = 8;
export const MIGRATION_EXPORT_KEEP_MS = 24 * 60 * 60 * 1000;
export const MIGRATION_BEFORE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const MIGRATION_FILE_EXTENSION = '.plasticine';

export const MigrationModeSchema = Type.Enum(['data', 'full']);
export type MigrationMode = Static<typeof MigrationModeSchema>;
export const MigrationHowSchema = Type.Enum(['merge', 'replace']);
export type MigrationHow = Static<typeof MigrationHowSchema>;

const Count = Type.Integer({ minimum: 0 });
const Bytes = Type.Integer({ minimum: 0 });

export const MigrationCountsSchema = Type.Object({
  lines: Count,
  memory: Count,
  notes: Count,
  files: Count,
  books: Count,
  spaces: Count,
  skills: Count,
}, STRICT);
export type MigrationCounts = Static<typeof MigrationCountsSchema>;

export const MigrationSummarySchema = Type.Object({
  format: Type.Literal('plasticine-migration-v1'),
  mode: MigrationModeSchema,
  exportedAt: IsoTimeSchema,
  handle: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
  schema: Type.Array(Type.String({ maxLength: 100 })),
  counts: MigrationCountsSchema,
  bytes: Bytes,
}, STRICT);
export type MigrationSummary = Static<typeof MigrationSummarySchema>;

export const MigrationExportViewSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 100 }),
  mode: MigrationModeSchema,
  state: Type.Enum(['running', 'ready', 'failed']),
  doneBytes: Bytes,
  totalBytes: Bytes,
  fileBytes: Type.Union([Bytes, Type.Null()]),
  fileName: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  createdAt: IsoTimeSchema,
  expiresAt: Type.Union([IsoTimeSchema, Type.Null()]),
  error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
}, STRICT);
export type MigrationExportView = Static<typeof MigrationExportViewSchema>;

export const MigrationImportStateSchema = Type.Enum(['uploading', 'locked', 'staging', 'staged', 'applying', 'failed']);
export type MigrationImportState = Static<typeof MigrationImportStateSchema>;

export const MigrationImportViewSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 100 }),
  name: Type.String({ maxLength: 200 }),
  state: MigrationImportStateSchema,
  bytes: Bytes,
  received: Bytes,
  mode: Type.Union([MigrationModeSchema, Type.Null()]),
  encrypted: Type.Union([Type.Boolean(), Type.Null()]),
  summary: Type.Union([MigrationSummarySchema, Type.Null()]),
  stagedBytes: Bytes,
  how: Type.Union([MigrationHowSchema, Type.Null()]),
  error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  errorCode: Type.Union([Type.Enum(['too_new', 'bad_file', 'no_space', 'wrong_passphrase', 'failed']), Type.Null()]),
}, STRICT);
export type MigrationImportView = Static<typeof MigrationImportViewSchema>;

export const MigrationBeforeViewSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 100 }),
  how: MigrationHowSchema,
  at: IsoTimeSchema,
  expiresAt: IsoTimeSchema,
}, STRICT);
export type MigrationBeforeView = Static<typeof MigrationBeforeViewSchema>;

export const MigrationResultSchema = Type.Object({
  kind: Type.Enum(['merge', 'replace', 'undo']),
  at: IsoTimeSchema,
  handle: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
  exportedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  added: Type.Union([MigrationCountsSchema, Type.Null()]),
  kept: Count,
  error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
}, STRICT);
export type MigrationResult = Static<typeof MigrationResultSchema>;

export const MigrationStatusSchema = Type.Object({
  export: Type.Union([MigrationExportViewSchema, Type.Null()]),
  import: Type.Union([MigrationImportViewSchema, Type.Null()]),
  before: Type.Union([MigrationBeforeViewSchema, Type.Null()]),
  result: Type.Union([MigrationResultSchema, Type.Null()]),
  diskFreeBytes: Bytes,
}, STRICT);
export type MigrationStatus = Static<typeof MigrationStatusSchema>;

const Passphrase = Type.String({ minLength: MIGRATION_PASSPHRASE_MIN, maxLength: 1000 });

export const MigrationExportRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  mode: MigrationModeSchema,
  passphrase: Type.Optional(Passphrase),
}, STRICT);
export type MigrationExportRequest = Static<typeof MigrationExportRequestSchema>;

export const MigrationImportStartSchema = Type.Object({
  requestId: RequestIdSchema,
  name: Type.String({ minLength: 1, maxLength: 200 }),
  bytes: Type.Integer({ minimum: 1, maximum: MIGRATION_MAX_BYTES }),
}, STRICT);
export type MigrationImportStart = Static<typeof MigrationImportStartSchema>;

export const MigrationChunkResultSchema = Type.Object({ received: Bytes }, STRICT);
export type MigrationChunkResult = Static<typeof MigrationChunkResultSchema>;

export const MigrationUnlockRequestSchema = Type.Object({ passphrase: Passphrase }, STRICT);
export type MigrationUnlockRequest = Static<typeof MigrationUnlockRequestSchema>;

export const MigrationApplyRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  how: MigrationHowSchema,
}, STRICT);
export type MigrationApplyRequest = Static<typeof MigrationApplyRequestSchema>;

export const MigrationCommandSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type MigrationCommand = Static<typeof MigrationCommandSchema>;

export const MigrationApplyResponseSchema = Type.Object({ restarting: Type.Boolean(), status: MigrationStatusSchema },
  STRICT);
export type MigrationApplyResponse = Static<typeof MigrationApplyResponseSchema>;
