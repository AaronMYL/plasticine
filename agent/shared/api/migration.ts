// 数据迁移（11-16 设计稿「Plasticine 数据迁移」）：设置 · 系统里「导出」「从另一台导入」两行。
// 导出两种：只要数据（不带密钥、登录、设备和地址，不要口令、不加密）/ 全部（连同这些，口令加密）。
// 导入一个弹框走完：分块上传 → 加了密的输口令 → 核对、选合并或替换 → 重启后在服务启动时应用；导入前在这台留一份，7 天内能退回。
// 都只给本人会话（requireUserAuth）：AI 用的内部浏览器不能导出、导入。

import { Type, type Static } from 'typebox';
import { IsoTimeSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false } as const;

export const MIGRATION_PATH = '/v2/migration';
export const MIGRATION_EXPORT_PATH = `${MIGRATION_PATH}/export`;
export const MIGRATION_EXPORT_CANCEL_PATH = `${MIGRATION_EXPORT_PATH}/cancel`;
/** 导出好的文件：GET 下载（带会话的普通链接，浏览器自己存）。 */
export const MIGRATION_EXPORT_FILE_PATH = `${MIGRATION_EXPORT_PATH}/file`;
export const MIGRATION_IMPORT_PATH = `${MIGRATION_PATH}/import`;
export const migrationChunkPath = (offset: number): string => `${MIGRATION_IMPORT_PATH}/chunks/${offset}`;
export const MIGRATION_IMPORT_COMPLETE_PATH = `${MIGRATION_IMPORT_PATH}/complete`;
export const MIGRATION_IMPORT_UNLOCK_PATH = `${MIGRATION_IMPORT_PATH}/unlock`;
export const MIGRATION_IMPORT_APPLY_PATH = `${MIGRATION_IMPORT_PATH}/apply`;
export const MIGRATION_IMPORT_CANCEL_PATH = `${MIGRATION_IMPORT_PATH}/cancel`;
export const MIGRATION_UNDO_PATH = `${MIGRATION_PATH}/undo`;

/** 上传一块最多这么大（和附件分块一样走原始字节）。 */
export const MIGRATION_CHUNK_BYTES = 8 * 1024 * 1024;
/** 一份迁移文件最大（服务器磁盘之外的上限，防一个请求把盘写满）。 */
export const MIGRATION_MAX_BYTES = 64 * 1024 ** 3;
/** 口令至少几位。 */
export const MIGRATION_PASSPHRASE_MIN = 8;
/** 导出的文件在这台留多久。 */
export const MIGRATION_EXPORT_KEEP_MS = 24 * 60 * 60 * 1000;
/** 导入前的那一份留多久。 */
export const MIGRATION_BEFORE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** 文件名后缀。 */
export const MIGRATION_FILE_EXTENSION = '.plasticine';

/** data：只要数据；full：连同密钥、登录、设备和地址（口令加密）。 */
export const MigrationModeSchema = Type.Enum(['data', 'full']);
export type MigrationMode = Static<typeof MigrationModeSchema>;
/** merge：这台的都留着，加进这台没有的；replace：整个换成这一份。 */
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

/** 文件里的第一条：哪台、哪天、什么版本的库、有多少。 */
export const MigrationSummarySchema = Type.Object({
  format: Type.Literal('plasticine-migration-v1'),
  mode: MigrationModeSchema,
  exportedAt: IsoTimeSchema,
  /** 导出那台的 @名字；没入网是 null。 */
  handle: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
  /** 导出那台的库到哪一步迁移（比这台新就不能导入）。 */
  schema: Type.Array(Type.String({ maxLength: 100 })),
  counts: MigrationCountsSchema,
  /** 打包前的大小（字节）。 */
  bytes: Bytes,
}, STRICT);
export type MigrationSummary = Static<typeof MigrationSummarySchema>;

export const MigrationExportViewSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 100 }),
  mode: MigrationModeSchema,
  state: Type.Enum(['running', 'ready', 'failed']),
  /** 打包到多少（字节，按打包前算）。 */
  doneBytes: Bytes,
  totalBytes: Bytes,
  /** 好了以后文件多大。 */
  fileBytes: Type.Union([Bytes, Type.Null()]),
  fileName: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  createdAt: IsoTimeSchema,
  /** 好了以后什么时候从这台删掉。 */
  expiresAt: Type.Union([IsoTimeSchema, Type.Null()]),
  error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
}, STRICT);
export type MigrationExportView = Static<typeof MigrationExportViewSchema>;

/**
 * uploading 传到一半；locked 加了密、等口令；staging 在核对和解开（加了密的要先给对口令）；staged 好了、等他选；
 * applying 选好了、解开完就重启；failed 坏了（文件不对、版本太新、磁盘不够）。
 */
export const MigrationImportStateSchema = Type.Enum(['uploading', 'locked', 'staging', 'staged', 'applying', 'failed']);
export type MigrationImportState = Static<typeof MigrationImportStateSchema>;

export const MigrationImportViewSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 100 }),
  name: Type.String({ maxLength: 200 }),
  state: MigrationImportStateSchema,
  bytes: Bytes,
  received: Bytes,
  /** 文件头里写的：只要数据还是全部、加没加密（传完才知道）。 */
  mode: Type.Union([MigrationModeSchema, Type.Null()]),
  encrypted: Type.Union([Type.Boolean(), Type.Null()]),
  summary: Type.Union([MigrationSummarySchema, Type.Null()]),
  /** 解开到多少（字节）。 */
  stagedBytes: Bytes,
  how: Type.Union([MigrationHowSchema, Type.Null()]),
  /** too_new：这一份是更新的版本导出的，这台要先更新。 */
  error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  errorCode: Type.Union([Type.Enum(['too_new', 'bad_file', 'no_space', 'wrong_passphrase', 'failed']), Type.Null()]),
}, STRICT);
export type MigrationImportView = Static<typeof MigrationImportViewSchema>;

/** 导入前留的那一份（7 天内能退回）。 */
export const MigrationBeforeViewSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 100 }),
  how: MigrationHowSchema,
  at: IsoTimeSchema,
  expiresAt: IsoTimeSchema,
}, STRICT);
export type MigrationBeforeView = Static<typeof MigrationBeforeViewSchema>;

/** 刚应用完的一次（重启回来以后给一条提示用；一小时后不再报）。 */
export const MigrationResultSchema = Type.Object({
  kind: Type.Enum(['merge', 'replace', 'undo']),
  at: IsoTimeSchema,
  handle: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
  exportedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  /** 合并时加进来的。 */
  added: Type.Union([MigrationCountsSchema, Type.Null()]),
  /** 合并时两边都有、留了这台的条数。 */
  kept: Count,
  error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
}, STRICT);
export type MigrationResult = Static<typeof MigrationResultSchema>;

export const MigrationStatusSchema = Type.Object({
  export: Type.Union([MigrationExportViewSchema, Type.Null()]),
  import: Type.Union([MigrationImportViewSchema, Type.Null()]),
  before: Type.Union([MigrationBeforeViewSchema, Type.Null()]),
  result: Type.Union([MigrationResultSchema, Type.Null()]),
  /** 这台磁盘还剩多少（字节）。 */
  diskFreeBytes: Bytes,
}, STRICT);
export type MigrationStatus = Static<typeof MigrationStatusSchema>;

const Passphrase = Type.String({ minLength: MIGRATION_PASSPHRASE_MIN, maxLength: 1000 });

export const MigrationExportRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  mode: MigrationModeSchema,
  /** 只在 full 时给，至少 8 位。 */
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

/** 选好以后的回答：马上重启（这一页等它回来）。 */
export const MigrationApplyResponseSchema = Type.Object({ restarting: Type.Boolean(), status: MigrationStatusSchema },
  STRICT);
export type MigrationApplyResponse = Static<typeof MigrationApplyResponseSchema>;
