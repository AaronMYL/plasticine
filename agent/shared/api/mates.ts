import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { MODEL_PURPOSE_IDS } from './model-purposes.ts';
import { MATE_CHARACTERS } from './mate-characters.ts';
import { PROJECT_HUES } from './project-tag.ts';
import { RECORD_META } from '../state-common.ts';
import { LineViewSchema } from './lines.ts';

const STRICT = { additionalProperties: false };
const NullableId = Type.Union([IdSchema, Type.Null()]);
export const MATES_PATH = '/v2/mates';
export const MATE_GROUPS_PATH = '/v2/mate-groups';
export const MateDraftSchema = Type.Object({
  name: Type.String({ minLength: 2, maxLength: 40 }),
  /** 头像是 Plasticine-bot 的一个角色（11-13，原来是头像文字）；颜色是 hue。 */
  avatar: Type.Enum(MATE_CHARACTERS),
  hue: Type.Enum(PROJECT_HUES),
  role: Type.String({ minLength: 2, maxLength: 160 }),
  soul: Type.String({ maxLength: 20_000 }),
  purpose: Type.Union([Type.Enum(MODEL_PURPOSE_IDS), Type.Null()]),
}, STRICT);
export type MateDraft = Static<typeof MateDraftSchema>;
export const MateViewSchema = Type.Object({ ...RECORD_META, ...MateDraftSchema.properties,
  lineId: IdSchema, disabledAt: Type.Union([IsoTimeSchema, Type.Null()]) }, STRICT);
export type MateView = Static<typeof MateViewSchema>;
export const MateGroupDraftSchema = Type.Object({ name: Type.String({ minLength: 2, maxLength: 60 }),
  mateIds: Type.Array(IdSchema, { minItems: 2, maxItems: 6, uniqueItems: true }) }, STRICT);
export type MateGroupDraft = Static<typeof MateGroupDraftSchema>;
export const MateGroupViewSchema = Type.Object({ ...RECORD_META, ...MateGroupDraftSchema.properties,
  lineId: IdSchema }, STRICT);
export type MateGroupView = Static<typeof MateGroupViewSchema>;
export const LegacyChatSchema = Type.Object({ lineId: IdSchema, title: Type.String(),
  updatedAt: IsoTimeSchema }, STRICT);
/**
 * 第 12 批：主线的名字。头像固定是 Plasticine 的泥团、漩涡当脸，颜色跟强调色（11-13 Aaron 定，原来的头像字和颜色去掉）。
 */
export const MAIN_PATH = '/v2/main';
export const DEFAULT_MAIN_NAME = 'Plasticine';
export const MainIdentitySchema = Type.Object({
  name: Type.String({ minLength: 2, maxLength: 20 }),
}, STRICT);
export type MainIdentity = Static<typeof MainIdentitySchema>;
export const DEFAULT_MAIN: MainIdentity = { name: DEFAULT_MAIN_NAME };
export const UpdateMainRequestSchema = Type.Object({ requestId: RequestIdSchema,
  ...MainIdentitySchema.properties }, STRICT);
export type UpdateMainRequest = Static<typeof UpdateMainRequestSchema>;
export const MainResponseSchema = Type.Object({ main: MainIdentitySchema }, STRICT);
export const MateListResponseSchema = Type.Object({ mates: Type.Array(MateViewSchema),
  groups: Type.Array(MateGroupViewSchema), legacyChats: Type.Array(LegacyChatSchema),
  main: Type.Optional(MainIdentitySchema) }, STRICT);
export type MateListResponse = Static<typeof MateListResponseSchema>;
export const CreateMateRequestSchema = Type.Object({ requestId: RequestIdSchema,
  ...MateDraftSchema.properties }, STRICT);
export type CreateMateRequest = Static<typeof CreateMateRequestSchema>;
// soul 只在建队友时用（拆成只对它的规则，11-11）；之后的规矩在记忆页改，这里不再收。
export const UpdateMateRequestSchema = Type.Object({ requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }),
  ...Type.Partial(Type.Omit(MateDraftSchema, ['soul'])).properties, disabled: Type.Optional(Type.Boolean()) }, STRICT);
export type UpdateMateRequest = Static<typeof UpdateMateRequestSchema>;
export const CreateMateGroupRequestSchema = Type.Object({ requestId: RequestIdSchema,
  ...MateGroupDraftSchema.properties }, STRICT);
export type CreateMateGroupRequest = Static<typeof CreateMateGroupRequestSchema>;
export const UpdateMateGroupRequestSchema = Type.Object({ requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }), ...Type.Partial(MateGroupDraftSchema).properties }, STRICT);
export type UpdateMateGroupRequest = Static<typeof UpdateMateGroupRequestSchema>;
export const MateHandoffRequestSchema = Type.Object({ requestId: RequestIdSchema, mateId: IdSchema,
  sourceLineId: IdSchema, goal: Type.String({ minLength: 1, maxLength: 20_000 }),
  groupId: Type.Optional(NullableId) }, STRICT);
export type MateHandoffRequest = Static<typeof MateHandoffRequestSchema>;
export const MateHandoffResponseSchema = Type.Object({ line: LineViewSchema }, STRICT);
export type MateHandoffResponse = Static<typeof MateHandoffResponseSchema>;
export const LegacyChatProposalSchema = Type.Object({ lineId: IdSchema, title: Type.String(),
  recommendation: Type.Enum(['mate', 'merge']), reason: Type.String(), draft: MateDraftSchema }, STRICT);
export type LegacyChatProposal = Static<typeof LegacyChatProposalSchema>;
export const LegacyChatPrepareRequestSchema = Type.Object({ lineId: IdSchema }, STRICT);
export const LegacyChatConvertRequestSchema = Type.Object({ requestId: RequestIdSchema,
  lineId: IdSchema, action: Type.Enum(['mate', 'merge']), draft: Type.Optional(MateDraftSchema) }, STRICT);
export type LegacyChatConvertRequest = Static<typeof LegacyChatConvertRequestSchema>;
export const LegacyChatConvertResponseSchema = Type.Object({ lineId: IdSchema,
  mate: Type.Union([MateViewSchema, Type.Null()]) }, STRICT);
export type LegacyChatConvertResponse = Static<typeof LegacyChatConvertResponseSchema>;
