import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { MemoryLineSourceSchema } from './memory-topics.ts';

export const SOUL_PATH = `${API_PREFIX}/soul`;
export const SOUL_SECTIONS = ['speaking', 'doing', 'outbound'] as const;
export type SoulSection = (typeof SOUL_SECTIONS)[number];
export const SOUL_SECTION_LABELS: Readonly<Record<SoulSection, string>> = {
  speaking: '说话', doing: '做事', outbound: '对外',
};
export const SOUL_SOURCES = ['system', 'user', 'conversation', 'inference'] as const;
export const SoulLineSchema = Type.Object({
  id: IdSchema, version: Type.Integer({ minimum: 0 }), text: Type.String({ minLength: 1 }),
  section: Type.Enum(SOUL_SECTIONS), source: Type.Enum(SOUL_SOURCES), at: IsoTimeSchema,
  sources: Type.Array(MemoryLineSourceSchema),
});
export type SoulLine = Static<typeof SoulLineSchema>;
export const SoulChangeSchema = Type.Object({
  id: IdSchema, lineId: IdSchema, action: Type.Enum(['add', 'edit', 'move', 'undo']),
  text: Type.String(), at: IsoTimeSchema, actor: Type.Enum(['system', 'user', 'brain']),
});
export type SoulChange = Static<typeof SoulChangeSchema>;
export const SoulViewSchema = Type.Object({
  title: Type.String(), lines: Type.Array(SoulLineSchema), history: Type.Array(SoulChangeSchema),
});
export type SoulView = Static<typeof SoulViewSchema>;
const identity = { requestId: RequestIdSchema };
const target = { id: IdSchema, version: Type.Integer({ minimum: 0 }) };
const content = { text: Type.String({ minLength: 1, maxLength: 500 }), section: Type.Enum(SOUL_SECTIONS) };
const strict = { additionalProperties: false };
export const ChangeSoulRequestSchema = Type.Union([
  Type.Object({ ...identity, action: Type.Literal('add'), ...content }, strict),
  Type.Object({ ...identity, action: Type.Literal('edit'), ...target, ...content }, strict),
  Type.Object({ ...identity, action: Type.Literal('move'), ...target, section: Type.Enum(SOUL_SECTIONS) }, strict),
  Type.Object({ ...identity, action: Type.Literal('undo'), ...target }, strict),
]);
export type ChangeSoulRequest = Static<typeof ChangeSoulRequestSchema>;
