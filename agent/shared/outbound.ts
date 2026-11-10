import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Identity = Type.String({ minLength: 1, maxLength: 200 });
const Recipients = Type.Array(Identity, { maxItems: 200, uniqueItems: true });
const Content = Type.String({ maxLength: 100_000 });

/** 工具从已校验的参数和真实账号状态声明发送范围；不从工具名、提示词或正文猜权限。 */
export const OutboundSpecSchema = Type.Object({
  channel: Identity, account: Identity,
  recipients: Type.Array(Identity, { minItems: 1, maxItems: 200, uniqueItems: true }),
  category: Identity, content: Content,
}, STRICT);
export type OutboundSpec = Static<typeof OutboundSpecSchema>;

export const OutboundScopeSchema = Type.Union([
  Type.Object({ kind: Type.Literal('once') }, STRICT),
  Type.Object({ kind: Type.Literal('always') }, STRICT),
  Type.Object({ kind: Type.Literal('task'), binding: Type.Object({
    kind: Type.Enum(['line', 'schedule', 'project']), id: IdSchema,
  }, STRICT) }, STRICT),
]);
export type OutboundScope = Static<typeof OutboundScopeSchema>;

export const OutboundGrantInputSchema = Type.Object({
  actor: Identity, channel: Identity, account: Identity,
  recipientMode: Type.Enum(['list', 'all']), recipients: Recipients,
  category: Identity, fixedTexts: Nullable(Type.Array(Content, { minItems: 1, maxItems: 50, uniqueItems: true })),
  scope: OutboundScopeSchema, expiresAt: Nullable(IsoTimeSchema),
}, STRICT);
export type OutboundGrantInput = Static<typeof OutboundGrantInputSchema>;

export const OutboundGrantPatchSchema = Type.Partial(Type.Object({
  ...OutboundGrantInputSchema.properties, enabled: Type.Boolean(),
}, STRICT));
export type OutboundGrantPatch = Static<typeof OutboundGrantPatchSchema>;

export const OutboundGrantSchema = Type.Object({
  ...RECORD_META, ...OutboundGrantInputSchema.properties,
  enabled: Type.Boolean(), revokedAt: Nullable(IsoTimeSchema),
  usedCount: Type.Integer({ minimum: 0 }), lastUsedAt: Nullable(IsoTimeSchema),
  confirmedByDeviceId: IdSchema, confirmedAt: IsoTimeSchema,
  sourceAskId: Nullable(IdSchema),
  /** 旧卡没有真实账号记录；只能走原定时任务的页面核验，不参与通用工具授权。 */
  legacyScheduleId: Nullable(IdSchema),
});
export type OutboundGrant = Static<typeof OutboundGrantSchema>;

export const OUTBOUND_STATUSES = ['pending', 'completed', 'queued', 'sent', 'failed', 'unknown'] as const;
export const OutboundResultSchema = Type.Object({
  status: Type.Enum(['completed', 'queued', 'sent', 'failed', 'unknown']),
  summary: Type.String({ maxLength: 4_000 }), sourceRef: Nullable(Type.String({ maxLength: 2_000 })),
}, STRICT);
export type OutboundResult = Static<typeof OutboundResultSchema>;

export const OutboundLogSchema = Type.Object({
  id: IdSchema, grantId: IdSchema, actor: Identity, lineId: IdSchema,
  toolCallId: Type.String({ minLength: 1 }), toolName: Identity, argsDigest: Type.String(),
  ...OutboundSpecSchema.properties,
  status: Type.Enum(OUTBOUND_STATUSES), summary: Type.String(), sourceRef: Nullable(Type.String()),
  createdAt: IsoTimeSchema, finishedAt: Nullable(IsoTimeSchema),
});
export type OutboundLog = Static<typeof OutboundLogSchema>;

export const OutboundCardSchema = Type.Object({
  requested: OutboundSpecSchema, grant: OutboundGrantInputSchema,
  relatedGrantId: Nullable(IdSchema),
}, STRICT);
export type OutboundCard = Static<typeof OutboundCardSchema>;
