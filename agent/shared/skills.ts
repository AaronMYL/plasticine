import { Type, type Static } from 'typebox';

export const SKILL_NAME_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$';
export const SkillNameSchema = Type.String({ minLength: 1, maxLength: 64, pattern: SKILL_NAME_PATTERN });
export const SkillVersionSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });
export const SkillReadSchema = Type.Object({
  name: SkillNameSchema,
  version: Type.Optional(SkillVersionSchema),
  path: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8_000 })),
}, { additionalProperties: false });
export type SkillRead = Static<typeof SkillReadSchema>;
export const SkillWriteSchema = Type.Object({
  name: SkillNameSchema,
  content: Type.String({ minLength: 1, maxLength: 64_000 }),
  expectedVersion: Type.Union([SkillVersionSchema, Type.Null()]),
  files: Type.Optional(Type.Array(Type.Object({ path: Type.String({ minLength: 1, maxLength: 500 }),
    content: Type.String({ maxLength: 256_000 }) }, { additionalProperties: false }), { maxItems: 100 })),
  deletePaths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 100 })),
}, { additionalProperties: false });
export type SkillWrite = Static<typeof SkillWriteSchema>;
export const SkillSearchSchema = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 500 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
}, { additionalProperties: false });
export const SkillSourceSchema = Type.Object({
  kind: Type.Enum(['builtin', 'installed', 'agent']),
  origin: Type.String(),
  runId: Type.Union([Type.String(), Type.Null()]),
  taskId: Type.Union([Type.String(), Type.Null()]),
  actionId: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
});
export type SkillSource = Static<typeof SkillSourceSchema>;
export const SkillDescriptorSchema = Type.Object({
  name: SkillNameSchema,
  description: Type.String(),
  version: SkillVersionSchema,
  source: SkillSourceSchema,
  directory: Type.String(),
  resources: Type.Array(Type.String()),
});
export type SkillDescriptor = Static<typeof SkillDescriptorSchema>;
