import { Type, type Static } from 'typebox';
import { SkillDescriptorSchema } from '../skills.ts';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';

export { SkillDescriptorSchema, SkillSourceSchema } from '../skills.ts';
export type { SkillDescriptor, SkillSource } from '../skills.ts';
export const SKILLS_PATH = `${API_PREFIX}/skills`;
/** 列表里的一个技能：目录摘要，加模型读过它几次（读正文算一次）、最近一次什么时候。 */
export const SkillRowSchema = Type.Object({
  ...SkillDescriptorSchema.properties,
  uses: Type.Integer({ minimum: 0 }),
  lastUsedAt: Type.Union([IsoTimeSchema, Type.Null()]),
});
export type SkillRow = Static<typeof SkillRowSchema>;
export const SkillListResponseSchema = Type.Object({
  skills: Type.Array(SkillRowSchema),
  issues: Type.Array(Type.Object({ name: Type.String(), reason: Type.String() })),
  total: Type.Integer({ minimum: 0 }),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});
export type SkillListResponse = Static<typeof SkillListResponseSchema>;
export const SkillPageSchema = Type.Object({
  ...SkillDescriptorSchema.properties,
  path: Type.String(), text: Type.String(), offset: Type.Integer({ minimum: 0 }),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  totalChars: Type.Integer({ minimum: 0 }), instructionAuthority: Type.Literal('method'), note: Type.String(),
});
export type SkillPage = Static<typeof SkillPageSchema>;
export const SkillResponseSchema = Type.Object({ skill: SkillPageSchema });
export type SkillResponse = Static<typeof SkillResponseSchema>;

/** DELETE /v2/skills/:name：删一个装上的技能（挪到 .removed 留底）；内置的 409。 */
export const RemoveSkillRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });
export type RemoveSkillRequest = Static<typeof RemoveSkillRequestSchema>;
export const RemoveSkillResponseSchema = Type.Object({ name: Type.String() });
export type RemoveSkillResponse = Static<typeof RemoveSkillResponseSchema>;
